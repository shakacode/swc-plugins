use std::collections::HashSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Warning,
    Invariant,
}

#[derive(serde::Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(test, derive(ts_rs::TS, serde::Serialize))]
pub struct PluginOptions {
    #[cfg_attr(test, ts(type = "ReadonlyArray<string>", optional))]
    warning_sources: Vec<String>,
    #[cfg_attr(test, ts(type = "ReadonlyArray<string>", optional))]
    invariant_sources: Vec<String>,
}

pub struct Config {
    warning_sources: HashSet<String>,
    invariant_sources: HashSet<String>,
}

impl Default for PluginOptions {
    fn default() -> Self {
        Self {
            warning_sources: [
                "warning",
                "tiny-warning",
                "fbjs/lib/warning",
                "fbjs/lib/warning.js",
                "hey-listen",
            ]
            .into_iter()
            .map(String::from)
            .collect(),
            invariant_sources: [
                "invariant",
                "tiny-invariant",
                "fbjs/lib/invariant",
                "fbjs/lib/invariant.js",
                "hey-listen",
            ]
            .into_iter()
            .map(String::from)
            .collect(),
        }
    }
}

impl Config {
    pub fn parse(json: &str) -> Result<Self, String> {
        let mut deserializer = serde_json::Deserializer::from_str(json);
        let options: PluginOptions = serde_path_to_error::deserialize(&mut deserializer)
            .map_err(|error| error.to_string())?;
        deserializer.end().map_err(|error| error.to_string())?;
        Ok(Self {
            warning_sources: options.warning_sources.into_iter().collect(),
            invariant_sources: options.invariant_sources.into_iter().collect(),
        })
    }

    pub fn kind(&self, source: &str, export: &str) -> Option<Kind> {
        let warning = self.warning_sources.contains(source);
        let invariant = self.invariant_sources.contains(source);
        match export {
            "warning" if warning => Some(Kind::Warning),
            "invariant" if invariant => Some(Kind::Invariant),
            "default" if warning && !invariant => Some(Kind::Warning),
            "default" if invariant && !warning => Some(Kind::Invariant),
            _ => None,
        }
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
    let defaults = format!(
        "{}\n",
        serde_json::to_string_pretty(&PluginOptions::default()).unwrap()
    );
    for (filename, contents) in [
        ("index.d.ts", declaration),
        ("src/default-options.json", defaults),
    ] {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/transform-invariant-warning")
            .join(filename);
        // Format generated artifacts with the repository's formatter.
        use std::io::Write;
        use std::process::{Command, Stdio};
        let mut formatter = Command::new("pnpm")
            .current_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
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
