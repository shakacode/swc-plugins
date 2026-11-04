use std::collections::HashSet;

#[derive(Default, serde::Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct PluginOptions {
    #[cfg_attr(test, ts(as = "Option<_>", optional))]
    pub remove_validators: bool,
    #[cfg_attr(test, ts(as = "Option<_>", optional))]
    pub additional_libraries: Vec<String>,
}

pub struct Config {
    pub remove_validators: bool,
    pub sources: HashSet<String>,
}

impl Config {
    pub fn parse(json: &str) -> Result<Self, String> {
        let mut deserializer = serde_json::Deserializer::from_str(json);
        let options: PluginOptions = serde_path_to_error::deserialize(&mut deserializer)
            .map_err(|error| error.to_string())?;
        deserializer.end().map_err(|error| error.to_string())?;
        let mut sources: HashSet<_> = options.additional_libraries.into_iter().collect();
        sources.insert("prop-types".into());
        Ok(Self {
            remove_validators: options.remove_validators,
            sources,
        })
    }
}

#[cfg(test)]
#[test]
fn exported_options_are_current() {
    use ts_rs::TS;
    let declaration = format!(
        "// Generated from Rust by ts-rs. Run pnpm types:generate to update.\nexport {}\n",
        PluginOptions::decl(&ts_rs::Config::default()),
    );
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/remove-prop-types/index.d.ts");
    // Use the same formatter as the rest of the repository before comparing output.
    use std::io::Write;
    use std::process::{Command, Stdio};
    let mut formatter = Command::new("pnpm")
        .current_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
        .args(["exec", "oxfmt", "-c", ".oxfmtrc.jsonc", "--stdin-filepath"])
        .arg(&path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("pnpm and Oxfmt must be installed to check generated declarations");
    formatter
        .stdin
        .take()
        .unwrap()
        .write_all(declaration.as_bytes())
        .unwrap();
    let output = formatter.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "Oxfmt failed to format the declaration"
    );
    let declaration = String::from_utf8(output.stdout).unwrap();
    if std::env::var_os("UPDATE_BINDINGS").is_some() {
        std::fs::write(&path, &declaration).unwrap();
    }
    assert_eq!(
        std::fs::read_to_string(&path).unwrap_or_default(),
        declaration,
        "Run pnpm types:generate and commit the generated declaration"
    );
}
