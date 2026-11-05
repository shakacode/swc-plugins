use swc_core::{
    common::{FileName, GLOBALS, Globals, Mark, SourceMap, sync::Lrc},
    ecma::{
        codegen::to_code_default,
        parser::{Syntax, TsSyntax, parse_file_as_program},
        transforms::base::resolver,
        visit::VisitMutWith,
    },
};
use swc_plugin_remove_prop_types::transform;

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
fn removes_definitions_without_evaluating_them() {
    let code = rewrite(
        "function Component() {} Component.propTypes = missing();",
        "{}",
    )
    .unwrap();
    assert!(!code.contains("missing"), "{code}");
}

#[test]
fn validates_options_even_for_preserved_modules() {
    for options in [
        r#"{"removeValidators":"yes"}"#,
        r#"{"additionalLibraries":42}"#,
        r#"{"removeImport":true}"#,
        r#"{} trailing"#,
    ] {
        assert!(rewrite("exports.propTypes = {};", options).is_err());
    }
}

#[test]
fn removes_static_and_define_property_definitions() {
    let code = rewrite("class Component { static propTypes = missing(); field = 1; } Object.defineProperty(Component, 'propTypes', missing());", "{}").unwrap();
    assert!(!code.contains("missing"), "{code}");
    assert!(code.contains("field"), "{code}");
}

#[test]
fn keeps_runtime_metadata_and_exported_dictionaries_in_both_modes() {
    for source in [
        "const Component = {}; Component.propTypes = { field: validate }; use(Object.keys(Component.propTypes));",
        "export const propTypes = { field: validate };",
        "const schema = { field: validate }; export { schema as propTypes };",
        "exports.propTypes = { field: validate };",
        "module.exports = { propTypes: { field: validate } };",
        "const C = {}; C.propTypes = { field: validate }; const { propTypes: schema } = C; use(schema);",
        "module.exports['propTypes'] = { field: validate };",
        "const target = exports; target.propTypes = { field: validate };",
        "Object.defineProperty(exports, 'propTypes', { value: validate });",
    ] {
        for options in ["{}", r#"{"removeValidators":true}"#] {
            let code = rewrite(source, options).unwrap();
            assert!(code.contains("validate"), "{source}: {code}");
            assert!(code.contains("propTypes"), "{source}: {code}");
        }
    }
}

#[test]
fn unused_imports_are_pruned_but_runtime_and_side_effect_imports_remain() {
    let code = rewrite("import PT, {checkPropTypes} from 'prop-types'; import 'prop-types'; function C() {} C.propTypes = {a: PT.string}; checkPropTypes(schema);", "{}").unwrap();
    assert!(!code.contains("PT"), "{code}");
    assert!(code.contains("checkPropTypes"), "{code}");
    assert!(code.contains("import 'prop-types'"), "{code}");
}

#[test]
fn standalone_validators_are_preserved_by_default() {
    let source = "import PT from 'prop-types'; export const validate = PT.string.isRequired;";
    assert!(
        rewrite(source, "{}")
            .unwrap()
            .contains("PT.string.isRequired")
    );
    let code = rewrite(source, r#"{"removeValidators":true}"#).unwrap();
    assert!(code.contains("validate = null"), "{code}");
    assert!(!code.contains("prop-types"), "{code}");
}

#[test]
fn exact_source_matching_and_shadowing_are_preserved() {
    let code = rewrite("import PT from 'prop-types/extra'; const value = PT.string; function read(PT) { return PT.string; }", r#"{"removeValidators":true}"#).unwrap();
    assert!(code.contains("value = PT.string"), "{code}");
    assert!(code.contains("return PT.string"), "{code}");
    let code = rewrite(
        "import PT from 'custom-validators'; export const value = PT.string;",
        r#"{"removeValidators":true,"additionalLibraries":["custom-validators"]}"#,
    )
    .unwrap();
    assert!(code.contains("value = null"), "{code}");
}

#[test]
fn shadowed_object_and_unknown_define_helpers_are_not_removed() {
    let code = rewrite("function run(Object) { Object.defineProperty(C, 'propTypes', descriptor); } function defineProperty() { sideEffect(); } defineProperty(C, 'propTypes', descriptor);", "{}").unwrap();
    assert!(code.contains("Object.defineProperty"), "{code}");
    assert!(code.contains("defineProperty(C"), "{code}");
}

#[test]
fn reassigned_bindings_and_aliases_are_not_neutralized() {
    for source in [
        "let PT = require('prop-types'); PT = runtime; exports.value = PT.string;",
        "var PT = require('prop-types'); var PT = runtime; exports.value = PT.string;",
        "const PT = require('prop-types'); const alias = PT; alias.string = runtime; exports.value = PT.string;",
        "let PT = require('prop-types'); const alias = PT; PT.string = runtime; exports.value = alias.string;",
        "import PT from 'prop-types'; PT.string = runtime; exports.value = PT.string;",
    ] {
        let code = rewrite(source, r#"{"removeValidators":true}"#).unwrap();
        assert!(code.contains(".string"), "{code}");
        assert!(code.contains("runtime"), "{code}");
    }
}

#[test]
fn prunes_dead_require_alias_chains_and_preserves_exported_bindings() {
    let code = rewrite(
        "const PT = require('prop-types'); const alias = PT; C.propTypes = {field: alias.string};",
        "{}",
    )
    .unwrap();
    assert!(!code.contains("require"), "{code}");
    let code = rewrite("export const PT = require('prop-types');", "{}").unwrap();
    assert!(code.contains("require"), "{code}");
}

#[test]
fn exported_import_equals_and_type_only_imports_remain() {
    let code = rewrite("export import PT = require('prop-types');", "{}").unwrap();
    assert!(code.contains("require('prop-types')"), "{code}");
    let code = rewrite(
        "import type PT from 'prop-types'; export type T = typeof PT;",
        "{}",
    )
    .unwrap();
    assert!(code.contains("import type PT"), "{code}");
}

#[test]
fn unknown_interop_helpers_remain_runtime_calls() {
    let code = rewrite("function _interopRequireDefault(value) { return runtime; } const PT = _interopRequireDefault(require('prop-types')); exports.value = PT.string;", r#"{"removeValidators":true}"#).unwrap();
    assert!(code.contains("PT.string"), "{code}");
    assert!(code.contains("_interopRequireDefault(require"), "{code}");
}

#[test]
fn optional_validator_construction_drops_arguments_and_required_chains() {
    for expression in [
        "PT.shape?.(missing())",
        "PT?.shape(missing()).isRequired",
        "(PT.shape as Factory)?.(missing()).isRequired",
    ] {
        let source = format!("import PT from 'prop-types'; exports.value = {expression};");
        let code = rewrite(&source, r#"{"removeValidators":true}"#).unwrap();
        assert!(!code.contains("missing"), "{code}");
        assert!(!code.contains("prop-types"), "{code}");
    }
}

#[test]
fn assignment_targets_with_typescript_wrappers_keep_mutated_aliases() {
    let code = rewrite("import PT from 'prop-types'; let validate; (validate as Validator) = PT.string; validate.custom = 42; use(validate.custom);", r#"{"removeValidators":true}"#).unwrap();
    assert!(code.contains("PT.string"), "{code}");
    assert!(!code.contains("= null"), "{code}");
}

#[test]
fn modified_interop_helpers_keep_initializer_effects() {
    let code = rewrite("import { _ as interop } from '@swc/helpers/_/_interop_require_default'; interop._ = record; const PT = interop._(require('prop-types'));", "{}").unwrap();
    assert!(code.contains("interop._(require('prop-types'))"), "{code}");
}
