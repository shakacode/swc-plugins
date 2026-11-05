use std::collections::{HashMap, HashSet, VecDeque};

use swc_core::{
    common::SyntaxContext,
    ecma::{
        ast::*,
        visit::{Visit, VisitWith},
    },
};

use crate::config::Config;

#[derive(Clone)]
pub enum Kind {
    Module,
    Validator(String),
}

pub fn text(expr: &Expr) -> Option<&str> {
    match expr {
        Expr::Lit(Lit::Str(value)) => value.value.as_str(),
        Expr::Tpl(value) if value.exprs.is_empty() => {
            value.quasis.first()?.cooked.as_ref()?.as_str()
        }
        _ => None,
    }
}

pub fn member_name(member: &MemberExpr) -> Option<&str> {
    match &member.prop {
        MemberProp::Ident(name) => Some(name.sym.as_ref()),
        MemberProp::Computed(key) => text(&key.expr),
        _ => None,
    }
}

pub fn unwrapped(expr: &Expr) -> &Expr {
    match expr {
        Expr::Paren(value) => unwrapped(&value.expr),
        Expr::TsAs(value) => unwrapped(&value.expr),
        Expr::TsSatisfies(value) => unwrapped(&value.expr),
        Expr::TsNonNull(value) => unwrapped(&value.expr),
        Expr::TsTypeAssertion(value) => unwrapped(&value.expr),
        Expr::TsInstantiation(value) => unwrapped(&value.expr),
        _ => expr,
    }
}

fn interop_argument<'a>(expr: &'a Expr, helpers: &HashSet<Id>) -> Option<&'a Expr> {
    let Expr::Call(call) = unwrapped(expr) else {
        return None;
    };
    if call.args.len() != 1 || call.args[0].spread.is_some() {
        return None;
    }
    let Callee::Expr(callee) = &call.callee else {
        return None;
    };
    let callee = match unwrapped(callee) {
        Expr::Member(member) if matches!(member_name(member), Some("_" | "default")) => {
            unwrapped(&member.obj)
        }
        value => value,
    };
    let Expr::Ident(ident) = callee else {
        return None;
    };
    helpers
        .contains(&ident.to_id())
        .then_some(&*call.args[0].expr)
}

pub fn expression_member(expr: &Expr) -> Option<&MemberExpr> {
    match unwrapped(expr) {
        Expr::Member(member) => Some(member),
        Expr::OptChain(chain) => match &*chain.base {
            OptChainBase::Member(member) => Some(member),
            _ => None,
        },
        _ => None,
    }
}

pub fn expression_callee(expr: &Expr) -> Option<&Expr> {
    match unwrapped(expr) {
        Expr::Call(call) => match &call.callee {
            Callee::Expr(callee) => Some(callee),
            _ => None,
        },
        Expr::OptChain(chain) => match &*chain.base {
            OptChainBase::Call(call) => Some(&call.callee),
            _ => None,
        },
        _ => None,
    }
}

fn value_root(expr: &Expr) -> Option<&Ident> {
    if let Expr::Seq(sequence) = unwrapped(expr) {
        return sequence.exprs.last().and_then(|last| value_root(last));
    }
    if let Expr::Ident(id) = unwrapped(expr) {
        return Some(id);
    }
    if let Some(member) = expression_member(expr) {
        return value_root(&member.obj);
    }
    expression_callee(expr).and_then(value_root)
}

#[derive(Default)]
struct BoundNames(HashSet<Id>);
impl Visit for BoundNames {
    fn visit_binding_ident(&mut self, id: &BindingIdent) {
        self.0.insert(id.to_id());
    }
    fn visit_expr(&mut self, expr: &Expr) {
        if let Expr::Ident(id) = unwrapped(expr) {
            self.0.insert(id.to_id());
        }
    }
    fn visit_simple_assign_target(&mut self, target: &SimpleAssignTarget) {
        if !matches!(
            target,
            SimpleAssignTarget::Member(_)
                | SimpleAssignTarget::SuperProp(_)
                | SimpleAssignTarget::OptChain(_)
        ) {
            target.visit_children_with(self);
        }
    }
    fn visit_assign_pat(&mut self, pattern: &AssignPat) {
        pattern.left.visit_with(self);
    }
    fn visit_assign_pat_prop(&mut self, property: &AssignPatProp) {
        property.key.visit_with(self);
    }
    fn visit_prop_name(&mut self, _: &PropName) {}
}

fn pattern_bindings<N: VisitWith<BoundNames>>(pattern: &N) -> HashSet<Id> {
    let mut names = BoundNames::default();
    pattern.visit_with(&mut names);
    names.0
}

pub struct Bindings<'a> {
    pub kinds: HashMap<Id, Kind>,
    pub all: HashSet<Id>,
    aliases: HashMap<Id, Vec<Id>>,
    derived: HashMap<Id, Vec<Id>>,
    sources: HashMap<Id, String>,
    interop_helpers: HashSet<Id>,
    writes: HashSet<Id>,
    declarations: HashMap<Id, usize>,
    config: &'a Config,
    unresolved: SyntaxContext,
}

impl<'a> Bindings<'a> {
    pub fn globals_modified(&self) -> bool {
        ["Object", "require"].iter().any(|name| {
            let id: Id = ((*name).into(), self.unresolved);
            self.writes.contains(&id)
        })
    }

    pub fn collect(program: &Program, config: &'a Config, unresolved: SyntaxContext) -> Self {
        #[derive(Default)]
        struct Helpers(HashSet<Id>);
        impl Visit for Helpers {
            fn visit_import_decl(&mut self, import: &ImportDecl) {
                if !import.type_only
                    && import.src.value.as_str().is_some_and(|source| {
                        matches!(
                            source,
                            "@babel/runtime/helpers/interopRequireDefault"
                                | "@babel/runtime/helpers/interopRequireWildcard"
                                | "@babel/runtime/helpers/esm/interopRequireDefault"
                                | "@babel/runtime/helpers/esm/interopRequireWildcard"
                                | "@swc/helpers/_/_interop_require_default"
                                | "@swc/helpers/_/_interop_require_wildcard"
                        )
                    })
                {
                    for specifier in &import.specifiers {
                        if !specifier.is_type_only() {
                            self.0.insert(specifier.local().to_id());
                        }
                    }
                }
            }
        }
        let mut helpers = Helpers::default();
        program.visit_with(&mut helpers);
        let mut result = Self {
            interop_helpers: helpers.0,
            kinds: HashMap::new(),
            all: HashSet::new(),
            aliases: HashMap::new(),
            derived: HashMap::new(),
            sources: HashMap::new(),
            writes: HashSet::new(),
            declarations: HashMap::new(),
            config,
            unresolved,
        };
        program.visit_with(&mut result);
        let mut queue: VecDeque<_> = result.kinds.keys().cloned().collect();
        while let Some(id) = queue.pop_front() {
            for alias in result.aliases.get(&id).into_iter().flatten() {
                if !result.kinds.contains_key(alias) {
                    result
                        .kinds
                        .insert(alias.clone(), result.kinds[&id].clone());
                    queue.push_back(alias.clone());
                }
            }
        }
        result.writes.extend(
            result
                .declarations
                .iter()
                .filter(|(_, count)| **count > 1)
                .map(|(id, _)| id.clone()),
        );
        let mut related: HashMap<Id, Vec<Id>> = HashMap::new();
        for (source, aliases) in result.aliases.iter().chain(&result.derived) {
            for alias in aliases {
                related
                    .entry(source.clone())
                    .or_default()
                    .push(alias.clone());
                related
                    .entry(alias.clone())
                    .or_default()
                    .push(source.clone());
            }
        }
        let mut first_by_source: HashMap<&str, Id> = HashMap::new();
        for (id, source) in &result.sources {
            if let Some(first) = first_by_source.get(source.as_str()) {
                related.entry(first.clone()).or_default().push(id.clone());
                related.entry(id.clone()).or_default().push(first.clone());
            } else {
                first_by_source.insert(source, id.clone());
            }
        }
        let mut changed: VecDeque<_> = result.writes.iter().cloned().collect();
        while let Some(id) = changed.pop_front() {
            for alias in related.get(&id).into_iter().flatten() {
                if result.writes.insert(alias.clone()) {
                    changed.push_back(alias.clone());
                }
            }
        }
        result.kinds.retain(|id, _| !result.writes.contains(id));
        // A redeclared or mutated binding is no longer a removable library
        // binding: another initializer can have unrelated application effects.
        result.all = result.kinds.keys().cloned().collect();
        result
    }

    fn derive(&mut self, mut names: HashSet<Id>, expr: &Expr) {
        let Some(first) = names.iter().next().cloned() else {
            return;
        };
        let mut references = Identifiers::default();
        expr.visit_with(&mut references);
        // One binding connects references and names without a complete graph.
        for source in references.0.difference(&names) {
            self.derived
                .entry(source.clone())
                .or_default()
                .push(first.clone());
        }
        names.remove(&first);
        self.derived.entry(first).or_default().extend(names);
    }

    fn required(&self, expr: &Expr) -> Option<String> {
        let expr = interop_argument(expr, &self.interop_helpers).unwrap_or(expr);
        let Expr::Call(call) = unwrapped(expr) else {
            return None;
        };
        let Callee::Expr(callee) = &call.callee else {
            return None;
        };
        if !matches!(unwrapped(callee), Expr::Ident(id) if id.sym == "require" && id.ctxt == self.unresolved)
            || call.args.len() != 1
            || call.args[0].spread.is_some()
        {
            return None;
        }
        let source = text(&call.args[0].expr)?;
        self.config
            .sources
            .contains(source)
            .then(|| source.to_owned())
    }
}

impl Visit for Bindings<'_> {
    fn visit_binding_ident(&mut self, id: &BindingIdent) {
        *self.declarations.entry(id.to_id()).or_default() += 1;
        id.visit_children_with(self);
    }
    fn visit_fn_decl(&mut self, declaration: &FnDecl) {
        *self
            .declarations
            .entry(declaration.ident.to_id())
            .or_default() += 1;
        declaration.visit_children_with(self);
    }
    fn visit_import_decl(&mut self, import: &ImportDecl) {
        for specifier in &import.specifiers {
            *self
                .declarations
                .entry(specifier.local().to_id())
                .or_default() += 1;
        }
        if import.type_only
            || !import
                .src
                .value
                .as_str()
                .is_some_and(|source| self.config.sources.contains(source))
        {
            return;
        }
        for specifier in &import.specifiers {
            if specifier.is_type_only() {
                continue;
            }
            let kind = match specifier {
                ImportSpecifier::Named(named) => {
                    let name = named
                        .imported
                        .as_ref()
                        .map(|name| name.atom().to_string())
                        .unwrap_or_else(|| named.local.sym.to_string());
                    if name == "default" {
                        Kind::Module
                    } else {
                        Kind::Validator(name)
                    }
                }
                _ => Kind::Module,
            };
            self.kinds.insert(specifier.local().to_id(), kind);
            self.sources.insert(
                specifier.local().to_id(),
                import.src.value.as_str().unwrap().to_owned(),
            );
        }
    }

    fn visit_ts_import_equals_decl(&mut self, import: &TsImportEqualsDecl) {
        *self.declarations.entry(import.id.to_id()).or_default() += 1;
        if !import.is_type_only
            && let TsModuleRef::TsExternalModuleRef(reference) = &import.module_ref
            && reference
                .expr
                .value
                .as_str()
                .is_some_and(|source| self.config.sources.contains(source))
        {
            self.kinds.insert(import.id.to_id(), Kind::Module);
            self.sources.insert(
                import.id.to_id(),
                reference.expr.value.as_str().unwrap().to_owned(),
            );
        }
    }

    fn visit_var_declarator(&mut self, decl: &VarDeclarator) {
        if let Some(init) = &decl.init {
            let required_source = self.required(init);
            if interop_argument(init, &self.interop_helpers).is_some()
                && let Some(helper) = value_root(init)
            {
                self.derived
                    .entry(helper.to_id())
                    .or_default()
                    .extend(pattern_bindings(&decl.name));
            }

            if !matches!(decl.name, Pat::Ident(_)) {
                let names = pattern_bindings(&decl.name);
                if let Some(source) = &required_source {
                    for id in names {
                        self.sources.insert(id, source.clone());
                    }
                } else {
                    self.derive(names, init);
                }
            }

            match &decl.name {
                Pat::Ident(id) if required_source.is_some() => {
                    self.kinds.insert(id.to_id(), Kind::Module);
                    self.sources
                        .insert(id.to_id(), required_source.clone().unwrap());
                }
                Pat::Ident(id) => {
                    if let Expr::Ident(source) =
                        unwrapped(interop_argument(init, &self.interop_helpers).unwrap_or(init))
                    {
                        self.aliases
                            .entry(source.to_id())
                            .or_default()
                            .push(id.to_id());
                    } else if let Some(source) = value_root(init) {
                        self.derived
                            .entry(source.to_id())
                            .or_default()
                            .push(id.to_id());
                    }
                }
                Pat::Object(object) if required_source.is_some() => {
                    for prop in &object.props {
                        let binding = match prop {
                            ObjectPatProp::Assign(prop) if prop.value.is_none() => {
                                Some((prop.key.to_id(), prop.key.sym.to_string()))
                            }
                            ObjectPatProp::KeyValue(prop) => match (&prop.key, &*prop.value) {
                                (PropName::Ident(key), Pat::Ident(id)) => {
                                    Some((id.to_id(), key.sym.to_string()))
                                }
                                (PropName::Str(key), Pat::Ident(id)) => {
                                    key.value.as_str().map(|key| (id.to_id(), key.to_owned()))
                                }
                                _ => None,
                            },
                            _ => None,
                        };
                        if let Some((id, name)) = binding {
                            self.sources
                                .insert(id.clone(), required_source.clone().unwrap());
                            self.kinds.insert(
                                id,
                                if name == "default" {
                                    Kind::Module
                                } else {
                                    Kind::Validator(name)
                                },
                            );
                        }
                    }
                }
                _ => {}
            }
        }
        decl.visit_children_with(self);
    }

    fn visit_assign_pat(&mut self, pattern: &AssignPat) {
        self.derive(pattern_bindings(&pattern.left), &pattern.right);
        pattern.visit_children_with(self);
    }

    fn visit_assign_pat_prop(&mut self, property: &AssignPatProp) {
        if let Some(value) = &property.value {
            self.derive(HashSet::from([property.key.to_id()]), value);
        }
        property.visit_children_with(self);
    }

    fn visit_assign_expr(&mut self, expr: &AssignExpr) {
        // Any write through a binding makes validator substitution unsafe. Pruning
        // still uses the binding's real references, including this assignment.
        let mut written = Identifiers::default();
        expr.left.visit_with(&mut written);
        self.writes.extend(written.0);
        self.derive(pattern_bindings(&expr.left), &expr.right);
        expr.visit_children_with(self);
    }

    fn visit_update_expr(&mut self, expr: &UpdateExpr) {
        let mut written = Identifiers::default();
        expr.arg.visit_with(&mut written);
        self.writes.extend(written.0);
        expr.visit_children_with(self);
    }

    fn visit_unary_expr(&mut self, expr: &UnaryExpr) {
        if expr.op == UnaryOp::Delete {
            let mut written = Identifiers::default();
            expr.arg.visit_with(&mut written);
            self.writes.extend(written.0);
        }
        expr.visit_children_with(self);
    }

    fn visit_for_in_stmt(&mut self, stmt: &ForInStmt) {
        let mut written = Identifiers::default();
        stmt.left.visit_with(&mut written);
        self.writes.extend(written.0);
        stmt.visit_children_with(self);
    }
    fn visit_for_of_stmt(&mut self, stmt: &ForOfStmt) {
        let mut written = Identifiers::default();
        stmt.left.visit_with(&mut written);
        self.writes.extend(written.0);
        stmt.visit_children_with(self);
    }
}

#[derive(Default)]
pub struct Identifiers(pub HashSet<Id>);
impl Visit for Identifiers {
    fn visit_ident(&mut self, ident: &Ident) {
        self.0.insert(ident.to_id());
    }
}

pub fn live_bindings(program: &Program, bindings: &HashSet<Id>) -> HashSet<Id> {
    struct Usage<'a> {
        bindings: &'a HashSet<Id>,
        live: HashSet<Id>,
        dependencies: HashMap<Id, HashSet<Id>>,
        owner: Option<Id>,
        prunable_declaration: bool,
    }
    impl Visit for Usage<'_> {
        fn visit_stmt(&mut self, statement: &Stmt) {
            let previous = self.prunable_declaration;
            self.prunable_declaration = matches!(statement, Stmt::Decl(Decl::Var(_)));
            statement.visit_children_with(self);
            self.prunable_declaration = previous;
        }
        fn visit_import_decl(&mut self, _: &ImportDecl) {}
        fn visit_ts_import_equals_decl(&mut self, import: &TsImportEqualsDecl) {
            if import.is_export {
                self.live.insert(import.id.to_id());
            }
        }
        fn visit_var_declarator(&mut self, decl: &VarDeclarator) {
            if let Pat::Ident(id) = &decl.name
                && self.bindings.contains(&id.to_id())
            {
                // Loop headers and other retained declarations must keep their
                // initializer dependencies, even when the declared name is dead.
                if !self.prunable_declaration {
                    self.live.insert(id.to_id());
                }
                let previous = self.owner.replace(id.to_id());
                decl.init.visit_with(self);
                self.owner = previous;
            } else {
                decl.init.visit_with(self);
                decl.name.visit_with(self);
            }
        }
        fn visit_binding_ident(&mut self, _: &BindingIdent) {}
        fn visit_ident(&mut self, ident: &Ident) {
            let id = ident.to_id();
            if self.bindings.contains(&id) {
                if let Some(owner) = &self.owner {
                    self.dependencies
                        .entry(owner.clone())
                        .or_default()
                        .insert(id);
                } else {
                    self.live.insert(id);
                }
            }
        }
        fn visit_export_decl(&mut self, export: &ExportDecl) {
            if let Decl::Var(decl) = &export.decl {
                for declaration in &decl.decls {
                    let mut ids = Identifiers::default();
                    declaration.name.visit_with(&mut ids);
                    self.live.extend(ids.0);
                }
            }
            export.visit_children_with(self);
        }
    }
    let mut usage = Usage {
        bindings,
        live: HashSet::new(),
        dependencies: HashMap::new(),
        owner: None,
        prunable_declaration: false,
    };
    program.visit_with(&mut usage);
    let mut queue: VecDeque<_> = usage.live.iter().cloned().collect();
    while let Some(id) = queue.pop_front() {
        for dependency in usage.dependencies.get(&id).into_iter().flatten() {
            if usage.live.insert(dependency.clone()) {
                queue.push_back(dependency.clone());
            }
        }
    }
    usage.live
}
