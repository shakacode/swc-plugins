mod bindings;
mod config;

use bindings::{
    Bindings, Kind, expression_callee, expression_member, live_bindings, member_name, text,
    unwrapped,
};
use config::Config;
use std::collections::HashSet;
use swc_core::{
    common::{Mark, Span, Spanned, SyntaxContext, util::take::Take},
    ecma::{
        ast::*,
        visit::{Visit, VisitMut, VisitMutWith, VisitWith},
    },
};

#[cfg(target_arch = "wasm32")]
use swc_core::plugin::{plugin_transform, proxies::TransformPluginProgramMetadata};

fn property_name(property: &PropName) -> Option<&str> {
    match property {
        PropName::Ident(id) => Some(id.sym.as_ref()),
        PropName::Str(value) => value.value.as_str(),
        PropName::Computed(value) => text(&value.expr),
        _ => None,
    }
}

fn global(expr: &Expr, name: &str, unresolved: SyntaxContext) -> bool {
    matches!(unwrapped(expr), Expr::Ident(id) if id.sym == name && id.ctxt == unresolved)
}

fn exports_target(expr: &Expr, unresolved: SyntaxContext) -> bool {
    global(expr, "exports", unresolved)
        || expression_member(expr).is_some_and(|member| {
            member_name(member) == Some("exports") && global(&member.obj, "module", unresolved)
        })
}

fn assignment_member(assignment: &AssignExpr) -> Option<&MemberExpr> {
    if assignment.op != AssignOp::Assign {
        return None;
    }
    match &assignment.left {
        AssignTarget::Simple(SimpleAssignTarget::Member(member)) => Some(member),
        _ => None,
    }
}

fn define_target(call: &CallExpr, unresolved: SyntaxContext) -> Option<&Expr> {
    if call.args.len() != 3
        || call.args.iter().any(|arg| arg.spread.is_some())
        || text(&call.args[1].expr) != Some("propTypes")
    {
        return None;
    }
    let Callee::Expr(callee) = &call.callee else {
        return None;
    };
    let matches = match unwrapped(callee) {
        Expr::Member(member) => {
            member_name(member) == Some("defineProperty")
                && global(&member.obj, "Object", unresolved)
        }
        _ => false,
    };
    matches.then_some(&call.args[0].expr)
}

fn binds_metadata(pattern: &Pat) -> bool {
    match pattern {
        Pat::Ident(id) => id.sym == "propTypes",
        Pat::Array(array) => array.elems.iter().flatten().any(binds_metadata),
        Pat::Object(object) => object.props.iter().any(|prop| match prop {
            ObjectPatProp::Assign(value) => value.key.sym == "propTypes",
            ObjectPatProp::KeyValue(value) => binds_metadata(&value.value),
            ObjectPatProp::Rest(value) => binds_metadata(&value.arg),
        }),
        Pat::Assign(value) => binds_metadata(&value.left),
        Pat::Rest(value) => binds_metadata(&value.arg),
        _ => false,
    }
}

struct RuntimeMetadata {
    unresolved: SyntaxContext,
    found: bool,
}
impl Visit for RuntimeMetadata {
    fn visit_expr(&mut self, expr: &Expr) {
        // An exports object used as a value can escape through any expression,
        // including conditionals, calls, and nested assignments. Visit once with
        // member/assignment targets handled separately below.
        if exports_target(expr, self.unresolved)
            || expression_member(expr)
                .is_some_and(|member| exports_target(&member.obj, self.unresolved))
        {
            self.found = true;
        }
        expr.visit_children_with(self);
    }
    fn visit_prop(&mut self, prop: &Prop) {
        if matches!(prop, Prop::Shorthand(id) if id.sym == "propTypes")
            || matches!(prop, Prop::KeyValue(value) if property_name(&value.key) == Some("propTypes"))
        {
            self.found = true;
        }
        prop.visit_children_with(self);
    }
    fn visit_object_pat(&mut self, pattern: &ObjectPat) {
        if pattern.props.iter().any(|prop| match prop {
            ObjectPatProp::Assign(value) => value.key.sym == "propTypes",
            ObjectPatProp::KeyValue(value) => property_name(&value.key) == Some("propTypes"),
            _ => false,
        }) {
            self.found = true;
        }
        pattern.visit_children_with(self);
    }
    fn visit_member_expr(&mut self, member: &MemberExpr) {
        if member_name(member) == Some("propTypes") {
            self.found = true;
        }
        if !exports_target(&member.obj, self.unresolved) {
            member.obj.visit_with(self);
        }
        member.prop.visit_with(self);
    }
    fn visit_super_prop_expr(&mut self, member: &SuperPropExpr) {
        if match &member.prop {
            SuperProp::Ident(name) => name.sym == "propTypes",
            SuperProp::Computed(key) => text(&key.expr) == Some("propTypes"),
        } {
            self.found = true;
        }
        member.visit_children_with(self);
    }
    fn visit_assign_expr(&mut self, assignment: &AssignExpr) {
        if matches!(&assignment.left, AssignTarget::Simple(SimpleAssignTarget::Member(member)) if member_name(member) == Some("exports") && global(&member.obj, "module", self.unresolved))
        {
            self.found = true;
        }
        if exports_target(&assignment.right, self.unresolved) {
            self.found = true;
        }
        if let Some(member) = assignment_member(assignment)
            && member_name(member) == Some("propTypes")
        {
            if exports_target(&member.obj, self.unresolved) {
                self.found = true;
            }
            member.obj.visit_with(self);
            assignment.right.visit_with(self);
        } else {
            assignment.visit_children_with(self);
        }
    }
    fn visit_var_declarator(&mut self, decl: &VarDeclarator) {
        if decl
            .init
            .as_ref()
            .is_some_and(|expr| exports_target(expr, self.unresolved))
        {
            self.found = true;
        }
        decl.visit_children_with(self);
    }
    fn visit_export_decl(&mut self, export: &ExportDecl) {
        self.found |= match &export.decl {
            Decl::Var(decl) => decl.decls.iter().any(|decl| binds_metadata(&decl.name)),
            Decl::Fn(decl) => decl.ident.sym == "propTypes",
            Decl::Class(decl) => decl.ident.sym == "propTypes",
            _ => false,
        };
        export.visit_children_with(self);
    }
    fn visit_named_export(&mut self, export: &NamedExport) {
        for specifier in &export.specifiers {
            if let ExportSpecifier::Named(named) = specifier
                && named
                    .exported
                    .as_ref()
                    .unwrap_or(&named.orig)
                    .atom()
                    .as_ref()
                    == "propTypes"
            {
                self.found = true;
            }
        }
        export.visit_children_with(self);
    }
    fn visit_call_expr(&mut self, call: &CallExpr) {
        if define_target(call, self.unresolved)
            .is_some_and(|target| exports_target(target, self.unresolved))
        {
            self.found = true;
        }
        call.visit_children_with(self);
    }
}

pub fn transform(
    program: &mut Program,
    unresolved_mark: Mark,
    options: &str,
) -> Result<(), String> {
    let config = Config::parse(options)?;
    let unresolved = SyntaxContext::empty().apply_mark(unresolved_mark);
    let mut metadata = RuntimeMetadata {
        unresolved,
        found: false,
    };
    program.visit_with(&mut metadata);
    if metadata.found {
        return Ok(());
    }
    let bindings = Bindings::collect(program, &config, unresolved);
    if bindings.globals_modified() {
        return Ok(());
    }
    program.visit_mut_with(&mut Rewriter {
        config: &config,
        bindings: &bindings,
        unresolved,
    });
    let live = live_bindings(program, &bindings.all);
    let unused = bindings.all.difference(&live).cloned().collect();
    program.visit_mut_with(&mut Pruner { unused });
    Ok(())
}

struct Rewriter<'a> {
    config: &'a Config,
    bindings: &'a Bindings<'a>,
    unresolved: SyntaxContext,
}

fn validator_factory(name: &str) -> Option<bool> {
    match name {
        "arrayOf" | "exact" | "instanceOf" | "objectOf" | "oneOf" | "oneOfType" | "shape" => {
            Some(true)
        }
        "any" | "array" | "bigint" | "bool" | "element" | "elementType" | "func" | "node"
        | "number" | "object" | "string" | "symbol" => Some(false),
        _ => None,
    }
}

fn final_value(expr: &Expr) -> &Expr {
    match unwrapped(expr) {
        Expr::Seq(sequence) => sequence.exprs.last().map_or(expr, |last| final_value(last)),
        expr => expr,
    }
}

fn preserving_prefixes(expr: &Expr, replacement: Expr) -> Expr {
    fn collect(expr: &Expr, prefixes: &mut Vec<Expr>) {
        if let Expr::Seq(sequence) = unwrapped(expr) {
            if let Some((last, leading)) = sequence.exprs.split_last() {
                prefixes.extend(leading.iter().map(|expr| expr.as_ref().clone()));
                collect(last, prefixes);
            }
        } else if let Some(member) = expression_member(expr) {
            collect(&member.obj, prefixes);
        } else if let Some(callee) = expression_callee(expr) {
            collect(callee, prefixes);
        }
    }
    let mut prefixes = Vec::new();
    collect(expr, &mut prefixes);
    if prefixes.is_empty() {
        replacement
    } else {
        prefixes.push(replacement);
        Expr::Seq(SeqExpr {
            span: expr.span(),
            exprs: prefixes.into_iter().map(Box::new).collect(),
        })
    }
}

impl Rewriter<'_> {
    fn module(&self, expr: &Expr) -> bool {
        let expr = final_value(expr);
        if let Expr::Ident(id) = unwrapped(expr) {
            return matches!(self.bindings.kinds.get(&id.to_id()), Some(Kind::Module));
        }
        expression_member(expr).is_some_and(|member| {
            member_name(member) == Some("default") && self.module(&member.obj)
        })
    }
    fn validator(&self, expr: &Expr) -> Option<bool> {
        let expr = final_value(expr);
        if let Expr::Ident(id) = unwrapped(expr) {
            return match self.bindings.kinds.get(&id.to_id()) {
                Some(Kind::Validator(name)) => validator_factory(name),
                _ => None,
            };
        }
        let member = expression_member(expr)?;
        if self.module(&member.obj) {
            validator_factory(member_name(member)?)
        } else {
            None
        }
    }
    fn required_validator(&self, expr: &Expr) -> bool {
        let expr = final_value(expr);
        expression_member(expr).is_some_and(|member| {
            member_name(member) == Some("isRequired")
                && (self.validator(&member.obj).is_some()
                    || expression_callee(final_value(&member.obj))
                        .is_some_and(|callee| self.validator(callee).is_some()))
        })
    }
    fn removable_assignment(&self, assignment: &AssignExpr) -> bool {
        assignment_member(assignment).is_some_and(|member| {
            member_name(member) == Some("propTypes")
                && !exports_target(&member.obj, self.unresolved)
        })
    }
    fn removable_call(&self, call: &CallExpr) -> bool {
        define_target(call, self.unresolved)
            .is_some_and(|target| !exports_target(target, self.unresolved))
    }
}

fn null(span: Span) -> Expr {
    Expr::Lit(Lit::Null(Null { span }))
}
fn undefined(span: Span) -> Expr {
    Expr::Unary(UnaryExpr {
        span,
        op: UnaryOp::Void,
        arg: Box::new(Expr::Lit(Lit::Num(Number {
            span,
            value: 0.0,
            raw: None,
        }))),
    })
}

impl VisitMut for Rewriter<'_> {
    fn visit_mut_stmt(&mut self, statement: &mut Stmt) {
        if let Stmt::Expr(expr) = statement {
            let remove = match unwrapped(&expr.expr) {
                Expr::Assign(assignment) => self.removable_assignment(assignment),
                Expr::Call(call) => self.removable_call(call),
                _ => false,
            };
            if remove {
                *statement = Stmt::Empty(EmptyStmt { span: expr.span });
                return;
            }
        }
        statement.visit_mut_children_with(self);
    }
    fn visit_mut_class(&mut self, class: &mut Class) {
        class.body.retain(|member| !matches!(member, ClassMember::ClassProp(prop) if prop.is_static && prop.decorators.is_empty() && property_name(&prop.key) == Some("propTypes")));
        class.visit_mut_children_with(self);
    }
    fn visit_mut_expr(&mut self, expr: &mut Expr) {
        if let Expr::Assign(assignment) = expr {
            if self.removable_assignment(assignment) {
                *expr = *assignment.right.take();
                expr.visit_mut_with(self);
                return;
            }
            assignment.right.visit_mut_with(self);
            return;
        }
        if matches!(expr, Expr::Update(_))
            || matches!(expr, Expr::Unary(unary) if unary.op == UnaryOp::Delete)
        {
            return;
        }
        if let Expr::Call(call) = expr
            && self.removable_call(call)
        {
            *expr = *call.args[0].expr.take();
            expr.visit_mut_with(self);
            return;
        }
        if self.config.remove_validators {
            if self.required_validator(expr) {
                *expr = preserving_prefixes(expr, null(expr.span()));
                expr.visit_mut_children_with(self);
                return;
            }
            if let Some(callee) = expression_callee(expr)
                && (self.validator(callee).is_some() || self.required_validator(callee))
            {
                *expr = preserving_prefixes(expr, undefined(expr.span()));
                expr.visit_mut_children_with(self);
                return;
            }
            if let Some(factory) = self.validator(expr) {
                let span = expr.span();
                let replacement = if factory {
                    Expr::Arrow(ArrowExpr {
                        span,
                        ctxt: Default::default(),
                        params: vec![],
                        body: Box::new(ArrowFunctionBody::Expr(Box::new(null(span)))),
                        is_async: false,
                        is_generator: false,
                        type_params: None,
                        return_type: None,
                    })
                } else {
                    null(span)
                };
                *expr = preserving_prefixes(expr, replacement);
                expr.visit_mut_children_with(self);
                return;
            }
        }
        expr.visit_mut_children_with(self);
    }
}

struct Pruner {
    unused: HashSet<Id>,
}
impl Pruner {
    fn removable(&self, pattern: &Pat) -> bool {
        match pattern {
            Pat::Ident(id) => self.unused.contains(&id.to_id()),
            Pat::Object(object) => {
                !object.props.is_empty()
                    && object.props.iter().all(|prop| match prop {
                        ObjectPatProp::Assign(prop) => {
                            prop.value.is_none() && self.unused.contains(&prop.key.to_id())
                        }
                        ObjectPatProp::KeyValue(prop) => {
                            matches!(prop.key, PropName::Ident(_) | PropName::Str(_))
                                && self.removable(&prop.value)
                        }
                        _ => false,
                    })
            }
            _ => false,
        }
    }
}
impl VisitMut for Pruner {
    fn visit_mut_module_items(&mut self, items: &mut Vec<ModuleItem>) {
        items.retain_mut(|item| match item {
            ModuleItem::ModuleDecl(ModuleDecl::Import(import))
                if !import.type_only && !import.specifiers.is_empty() =>
            {
                import.specifiers.retain(|specifier| {
                    specifier.is_type_only() || !self.unused.contains(&specifier.local().to_id())
                });
                !import.specifiers.is_empty()
            }
            ModuleItem::ModuleDecl(ModuleDecl::TsImportEquals(import)) => {
                !self.unused.contains(&import.id.to_id())
            }
            _ => true,
        });
        items.visit_mut_children_with(self);
    }
    fn visit_mut_stmt(&mut self, statement: &mut Stmt) {
        if let Stmt::Decl(Decl::Var(var)) = statement {
            var.decls.retain(|decl| !self.removable(&decl.name));
            if var.decls.is_empty() {
                *statement = Stmt::Empty(EmptyStmt { span: var.span });
                return;
            }
        }
        statement.visit_mut_children_with(self);
    }
}

#[cfg(target_arch = "wasm32")]
#[plugin_transform]
pub fn process_transform(
    mut program: Program,
    metadata: TransformPluginProgramMetadata,
) -> Program {
    let config = metadata
        .get_transform_plugin_config()
        .unwrap_or_else(|| "{}".into());
    transform(&mut program, metadata.unresolved_mark, &config)
        .unwrap_or_else(|error| panic!("swc-plugin-remove-prop-types: {error}"));
    program
}
