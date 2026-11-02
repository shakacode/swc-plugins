use std::collections::{HashMap, HashSet};

use swc_core::{
    common::SyntaxContext,
    ecma::{
        ast::*,
        visit::{Visit, VisitWith},
    },
};

use crate::config::{Config, Kind};

pub struct Bindings<'a> {
    pub kinds: HashMap<Id, Kind>,
    pub writes: HashSet<Id>,
    declarations: HashMap<Id, usize>,
    config: &'a Config,
    unresolved: SyntaxContext,
}

impl<'a> Bindings<'a> {
    pub fn collect(program: &Program, config: &'a Config, unresolved: SyntaxContext) -> Self {
        let mut bindings = Self {
            kinds: HashMap::new(),
            writes: HashSet::new(),
            declarations: HashMap::new(),
            config,
            unresolved,
        };
        program.visit_with(&mut bindings);
        bindings.kinds.retain(|id, _| {
            !bindings.writes.contains(id) && bindings.declarations.get(id) == Some(&1)
        });
        bindings
    }

    fn declare(&mut self, ident: &Ident) {
        *self.declarations.entry(ident.to_id()).or_default() += 1;
    }

    fn add(&mut self, ident: &Ident, source: &str, export: &str) {
        if let Some(kind) = self.config.kind(source, export) {
            self.kinds.insert(ident.to_id(), kind);
        }
    }

    fn write_expr(&mut self, expr: &Expr) {
        match expr {
            Expr::Ident(ident) => {
                self.writes.insert(ident.to_id());
            }
            Expr::Paren(expr) => self.write_expr(&expr.expr),
            Expr::TsAs(expr) => self.write_expr(&expr.expr),
            Expr::TsSatisfies(expr) => self.write_expr(&expr.expr),
            Expr::TsNonNull(expr) => self.write_expr(&expr.expr),
            Expr::TsTypeAssertion(expr) => self.write_expr(&expr.expr),
            Expr::TsInstantiation(expr) => self.write_expr(&expr.expr),
            _ => {}
        }
    }

    fn write_pattern(&mut self, pattern: &Pat) {
        match pattern {
            Pat::Ident(ident) => {
                self.writes.insert(ident.to_id());
            }
            Pat::Array(array) => {
                for element in array.elems.iter().flatten() {
                    self.write_pattern(element);
                }
            }
            Pat::Object(object) => {
                for prop in &object.props {
                    match prop {
                        ObjectPatProp::KeyValue(prop) => self.write_pattern(&prop.value),
                        ObjectPatProp::Assign(prop) => {
                            self.writes.insert(prop.key.to_id());
                        }
                        ObjectPatProp::Rest(prop) => self.write_pattern(&prop.arg),
                    }
                }
            }
            Pat::Assign(assign) => self.write_pattern(&assign.left),
            Pat::Rest(rest) => self.write_pattern(&rest.arg),
            Pat::Expr(expr) => self.write_expr(expr),
            _ => {}
        }
    }

    fn write_loop_head(&mut self, head: &ForHead) {
        match head {
            ForHead::Pat(pattern) => self.write_pattern(pattern),
            ForHead::VarDecl(decl) => {
                for declarator in &decl.decls {
                    self.write_pattern(&declarator.name);
                }
            }
            ForHead::UsingDecl(_) => {}
        }
    }
}

fn module_name(expr: &Expr) -> Option<&str> {
    match expr {
        Expr::Lit(Lit::Str(literal)) => literal.value.as_str(),
        Expr::Tpl(template) if template.exprs.is_empty() => {
            template.quasis.first()?.cooked.as_ref()?.as_str()
        }
        _ => None,
    }
}

impl Visit for Bindings<'_> {
    fn visit_import_decl(&mut self, import: &ImportDecl) {
        for specifier in &import.specifiers {
            let local = specifier.local();
            self.declare(local);
            if import.type_only || specifier.is_type_only() {
                continue;
            }
            let Some(source) = import.src.value.as_str() else {
                continue;
            };
            match specifier {
                ImportSpecifier::Default(_) => self.add(local, source, "default"),
                ImportSpecifier::Named(named) => {
                    let export = match &named.imported {
                        Some(ModuleExportName::Ident(name)) => name.sym.as_ref(),
                        Some(ModuleExportName::Str(name)) => {
                            let Some(name) = name.value.as_str() else {
                                continue;
                            };
                            name
                        }
                        None => local.sym.as_ref(),
                    };
                    self.add(local, source, export);
                }
                ImportSpecifier::Namespace(_) => {}
            }
        }
    }

    fn visit_ts_import_equals_decl(&mut self, import: &TsImportEqualsDecl) {
        self.declare(&import.id);
        if !import.is_type_only
            && let TsModuleRef::TsExternalModuleRef(reference) = &import.module_ref
            && let Some(source) = reference.expr.value.as_str()
        {
            self.add(&import.id, source, "default");
        }
    }

    fn visit_binding_ident(&mut self, ident: &BindingIdent) {
        self.declare(&ident.id);
        ident.visit_children_with(self);
    }

    fn visit_fn_decl(&mut self, declaration: &FnDecl) {
        self.declare(&declaration.ident);
        declaration.visit_children_with(self);
    }

    fn visit_class_decl(&mut self, declaration: &ClassDecl) {
        self.declare(&declaration.ident);
        declaration.visit_children_with(self);
    }

    fn visit_var_declarator(&mut self, declaration: &VarDeclarator) {
        if let Pat::Ident(local) = &declaration.name
            && let Some(initializer) = &declaration.init
            && let Expr::Call(call) = &**initializer
            && let Callee::Expr(callee) = &call.callee
            && let Expr::Ident(require) = &**callee
            && require.sym == "require"
            && require.ctxt == self.unresolved
            && call.args.len() == 1
            && call.args[0].spread.is_none()
            && let Some(source) = module_name(&call.args[0].expr)
        {
            self.add(&local.id, source, "default");
        }
        declaration.visit_children_with(self);
    }

    fn visit_assign_expr(&mut self, assignment: &AssignExpr) {
        match &assignment.left {
            AssignTarget::Simple(SimpleAssignTarget::Ident(ident)) => {
                self.writes.insert(ident.to_id());
            }
            AssignTarget::Simple(target) => {
                let expr: Box<Expr> = target.clone().into();
                self.write_expr(&expr);
            }
            AssignTarget::Pat(pattern) => self.write_pattern(&pattern.clone().into()),
        }
        assignment.visit_children_with(self);
    }

    fn visit_update_expr(&mut self, update: &UpdateExpr) {
        self.write_expr(&update.arg);
        update.visit_children_with(self);
    }

    fn visit_for_in_stmt(&mut self, statement: &ForInStmt) {
        self.write_loop_head(&statement.left);
        statement.visit_children_with(self);
    }

    fn visit_for_of_stmt(&mut self, statement: &ForOfStmt) {
        self.write_loop_head(&statement.left);
        statement.visit_children_with(self);
    }
}
