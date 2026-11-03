import { copyFileSync } from 'node:fs';

copyFileSync(
  new URL(
    '../target/wasm32-wasip1/release/swc_plugin_transform_invariant_warning.wasm',
    import.meta.url,
  ),
  new URL('../packages/transform-invariant-warning/plugin.wasm', import.meta.url),
);
