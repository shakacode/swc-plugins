use std::collections::HashSet;

#[derive(Default, serde::Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(test, derive(ts_rs::TS, serde::Serialize))]
pub struct PluginOptions {
    #[cfg_attr(test, ts(type = "ReadonlyArray<string>", optional))]
    pub additional_libraries: Vec<String>,
}

pub struct Config {
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
        Ok(Self { sources })
    }
}

#[cfg(test)]
#[test]
fn exported_options_are_current() {
    swc_plugin_test_utils::assert_generated_options::<PluginOptions>(
        env!("CARGO_MANIFEST_DIR"),
        "remove-prop-types",
    );
}
