use swc_core::{
    common::{FileName, GLOBALS, Globals, Mark, SourceMap, sync::Lrc},
    ecma::{
        codegen::to_code_default,
        parser::{Syntax, TsSyntax, parse_file_as_program},
        transforms::base::resolver,
        visit::VisitMutWith,
    },
};
use swc_plugin_transform_invariant_warning::transform;

fn rewrite(source: &str, options: &str) -> Result<String, String> {
    GLOBALS.set(&Globals::new(), || {
        let cm: Lrc<SourceMap> = Default::default();
        let file = cm.new_source_file(
            FileName::Custom("fixture.ts".into()).into(),
            source.to_owned(),
        );
        let mut errors = vec![];
        let mut program = parse_file_as_program(
            &file,
            Syntax::Typescript(TsSyntax::default()),
            Default::default(),
            None,
            &mut errors,
        )
        .unwrap();
        assert!(errors.is_empty(), "{errors:?}");
        let unresolved = Mark::new();
        program.visit_mut_with(&mut resolver(unresolved, Mark::new(), true));
        transform(&mut program, unresolved, options)?;
        Ok(to_code_default(cm, None, &program))
    })
}

#[test]
fn warning_statement_is_removed() {
    assert_eq!(
        rewrite("warning(false, sideEffect());", "{}")
            .unwrap()
            .trim(),
        ";"
    );
}

#[test]
fn invariant_keeps_only_the_failure_path() {
    let code = rewrite("invariant(check(), message());", "{}").unwrap();
    assert!(code.contains("if (!check())"), "{code}");
    assert!(code.contains("invariant(false)"), "{code}");
    assert!(!code.contains("message()"), "{code}");
}

#[test]
fn invalid_configuration_reports_the_option() {
    let error = rewrite("warning(false);", r#"{"warningSources":42}"#).unwrap_err();
    assert!(error.contains("warningSources"), "{error}");
    assert!(
        rewrite("", r#"{"unknown":true}"#)
            .unwrap_err()
            .contains("unknown")
    );
}

#[test]
fn import_equals_binding_is_recognized() {
    let code = rewrite(
        "import check = require('invariant'); check(false, message());",
        "{}",
    )
    .unwrap();
    assert!(!code.contains("message()"), "{code}");
}

#[test]
fn type_only_import_is_preserved() {
    let code = rewrite(
        "import type warning from 'warning'; export type Warning = typeof warning;",
        "{}",
    )
    .unwrap();
    assert!(code.contains("import type warning"), "{code}");
    assert!(code.contains("type Warning = typeof warning"), "{code}");
}

#[test]
fn wrapped_assignment_targets_invalidate_bindings() {
    for target in [
        "(check)",
        "(check as any)",
        "(check satisfies any)",
        "check!",
        "(<any>check)",
    ] {
        let source = format!(
            "let check = require('invariant'); {target} = runtime; check(true, message());"
        );
        let code = rewrite(&source, "{}").unwrap();
        assert!(code.contains("message()"), "{target}: {code}");
    }
}

#[test]
fn member_assignment_targets_still_visit_nested_writes() {
    for (target, retains_message) in [("check.property", false), ("holder[check = runtime]", true)]
    {
        let source =
            format!("let check = require('invariant'); {target} = value; check(true, message());");
        let code = rewrite(&source, "{}").unwrap();
        assert_eq!(
            code.contains("message()"),
            retains_message,
            "{target}: {code}"
        );
    }
}
