use swc_core::{
    common::{FileName, GLOBALS, Globals, Mark, SourceMap, sync::Lrc},
    ecma::{
        codegen::to_code_default,
        parser::{Syntax, TsSyntax, parse_file_as_program},
        transforms::base::resolver,
        visit::VisitMutWith,
    },
};

pub fn rewrite(
    source: &str,
    options: &str,
    transform: impl FnOnce(&mut swc_core::ecma::ast::Program, Mark, &str) -> Result<(), String>,
) -> Result<String, String> {
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

pub fn assert_generated_options<Options: ts_rs::TS + serde::Serialize + Default>(
    manifest_directory: &str,
    package: &str,
) {
    let declaration = format!(
        "// Generated from Rust by ts-rs. Run pnpm types:generate to update.\nexport {}\n",
        Options::decl(&ts_rs::Config::default()),
    );
    let defaults = format!(
        "{}\n",
        serde_json::to_string_pretty(&Options::default()).unwrap()
    );
    for (filename, contents) in [
        ("index.d.ts", declaration),
        ("src/default-options.json", defaults),
    ] {
        let path = std::path::Path::new(manifest_directory)
            .join("../../packages")
            .join(package)
            .join(filename);
        use std::io::Write;
        use std::process::{Command, Stdio};
        let mut formatter = Command::new("pnpm")
            .current_dir(std::path::Path::new(manifest_directory).join("../.."))
            .args(["exec", "oxfmt", "-c", ".oxfmtrc.jsonc", "--stdin-filepath"])
            .arg(&path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("pnpm and Oxfmt must be installed to check generated artifacts");
        formatter
            .stdin
            .take()
            .unwrap()
            .write_all(contents.as_bytes())
            .unwrap();
        let output = formatter.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "Oxfmt failed to format generated artifacts"
        );
        let contents = String::from_utf8(output.stdout).unwrap();
        if std::env::var_os("UPDATE_BINDINGS").is_some() {
            std::fs::write(&path, &contents).unwrap();
        }
        assert_eq!(
            std::fs::read_to_string(&path).unwrap_or_default(),
            contents,
            "Run pnpm types:generate and commit the generated artifacts"
        );
    }
}
