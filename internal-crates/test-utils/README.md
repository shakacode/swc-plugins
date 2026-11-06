# Rust test utilities

Unpublished dev-dependency shared by the plugin crates. `rewrite` parses and resolves
native transform fixtures; `assert_generated_options` formats and checks generated
TypeScript options and JSON defaults. Plugin cases and option definitions stay in
their own crates. Default workspace members include only plugin crates, keeping this helper out of Wasm builds.
