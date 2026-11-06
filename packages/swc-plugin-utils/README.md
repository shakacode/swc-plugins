# @shakacode/swc-plugin-utils

Shared TypeScript host utilities for SWC plugins.

- `normalizeSourceOptions(options, defaults)` validates string-array options, applies defaults and snapshots the options as serialized for the Wasm guest.
- `createSourceFilter(options, names)` returns a `SourceFilter<Options>` with normalized `options`, `test(source)` and `testFile(filename, context)`.
- `SourceFilter<Options>` and `FileFilterContext` provide the shared types.

Pass normalized options to both `createSourceFilter` and the Wasm plugin. Include every name that can make a transformation relevant. Matching is conservative: escapes retain the guest, and carriage returns retain it when a name contains a newline.

`testFile` skips only with `watch: false` and `allowSkipping: true`. Read failures retain the guest. Supply `readSource` for virtual files or a custom filesystem. Disable skipping when earlier transforms can introduce relevant names.

MIT. See [LICENSE](LICENSE).
