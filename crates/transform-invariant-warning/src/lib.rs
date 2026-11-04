mod bindings;
mod config;

use std::collections::HashMap;

use swc_core::{
    common::{Mark, SyntaxContext, util::take::Take},
    ecma::{
        ast::*,
        visit::{VisitMut, VisitMutWith},
    },
};

use bindings::Bindings;
use config::{Config, Kind};

#[cfg(target_arch = "wasm32")]
use swc_core::plugin::{plugin_transform, proxies::TransformPluginProgramMetadata};

pub fn transform(program: &mut Program, unresolved_mark: Mark, config: &str) -> Result<(), String> {
    let config = Config::parse(config)?;
    let unresolved = SyntaxContext::empty().apply_mark(unresolved_mark);
    let bindings = Bindings::collect(program, &config, unresolved);
    if !bindings.kinds.is_empty() {
        program.visit_mut_with(&mut Rewriter {
            kinds: bindings.kinds,
        });
    }
    Ok(())
}

struct Rewriter {
    kinds: HashMap<Id, Kind>,
}

impl Rewriter {
    fn kind(&self, ident: &Ident) -> Option<Kind> {
        self.kinds.get(&ident.to_id()).copied()
    }
}

impl VisitMut for Rewriter {
    fn visit_mut_stmt(&mut self, statement: &mut Stmt) {
        if let Stmt::Expr(expression) = statement {
            // Removing an optional warning cannot evaluate its callee or arguments.
            if let Expr::OptChain(chain) = &*expression.expr
                && let OptChainBase::Call(call) = &*chain.base
                && let Expr::Ident(ident) = &*call.callee
                && self.kind(ident) == Some(Kind::Warning)
            {
                *statement = Stmt::Empty(EmptyStmt {
                    span: expression.span,
                });
                return;
            }
            if let Expr::Call(call) = &mut *expression.expr
                && let Callee::Expr(callee) = &call.callee
                && let Expr::Ident(ident) = &**callee
                && let Some(kind) = self.kind(ident)
            {
                let span = expression.span;
                if kind == Kind::Warning {
                    *statement = Stmt::Empty(EmptyStmt { span });
                    return;
                }
                if let Some(first) = call.args.first_mut()
                    && first.spread.is_none()
                {
                    let mut condition = first.expr.take();
                    condition.visit_mut_with(self);
                    let mut failure_call = call.take();
                    failure_call.args = vec![ExprOrSpread {
                        spread: None,
                        expr: Box::new(Expr::Lit(Lit::Bool(Bool { span, value: false }))),
                    }];
                    *statement = Stmt::Block(BlockStmt {
                        span,
                        ctxt: Default::default(),
                        stmts: vec![Stmt::If(IfStmt {
                            span,
                            test: Box::new(Expr::Unary(UnaryExpr {
                                span,
                                op: UnaryOp::Bang,
                                arg: condition,
                            })),
                            cons: Box::new(Stmt::Block(BlockStmt {
                                span,
                                ctxt: Default::default(),
                                stmts: vec![Stmt::Expr(ExprStmt {
                                    span,
                                    expr: Box::new(Expr::Call(failure_call)),
                                })],
                            })),
                            alt: None,
                        })],
                    });
                    return;
                }
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
        .unwrap_or_else(|error| panic!("swc-plugin-transform-invariant-warning: {error}"));
    program
}
