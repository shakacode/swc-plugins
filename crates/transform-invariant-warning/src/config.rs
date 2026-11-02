use std::collections::HashSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Warning,
    Invariant,
}

pub struct Config {
    warning_sources: HashSet<String>,
    invariant_sources: HashSet<String>,
    pub transform_globals: bool,
}

impl Default for Config {
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
            transform_globals: true,
        }
    }
}

impl Config {
    pub fn parse(json: &str) -> Result<Self, String> {
        let value: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
        let options = value
            .as_object()
            .ok_or("plugin options must be an object")?;
        let mut config = Self::default();
        for (key, value) in options {
            match key.as_str() {
                "warningSources" => {
                    config.warning_sources = serde_json::from_value(value.clone())
                        .map_err(|e| format!("warningSources: {e}"))?
                }
                "invariantSources" => {
                    config.invariant_sources = serde_json::from_value(value.clone())
                        .map_err(|e| format!("invariantSources: {e}"))?
                }
                "transformGlobals" => {
                    config.transform_globals = value
                        .as_bool()
                        .ok_or("transformGlobals must be a boolean")?
                }
                _ => return Err(format!("unknown plugin option: {key}")),
            }
        }
        Ok(config)
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
