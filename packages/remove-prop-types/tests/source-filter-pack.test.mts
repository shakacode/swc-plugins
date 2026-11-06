import {
  installPackedPackage,
  runConsumer,
  typecheckConsumer,
} from '@shakacode/swc-plugin-test-utils/package';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { temporaryDirectory } from '@shakacode/swc-plugin-test-utils/temp-dir';

test('packed package exposes compiled ESM, CommonJS and declaration entrypoints', (t) => {
  const directory = temporaryDirectory(t, 'source-filter-package-');
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  installPackedPackage(
    directory,
    fileURLToPath(new URL('../../swc-plugin-utils/', import.meta.url)),
  );
  const files = installPackedPackage(directory, cwd);
  for (const file of [
    'plugin.wasm',
    'index.d.ts',
    'dist/source-filter.mjs',
    'dist/source-filter.d.mts',
    'dist/default-options.json',
  ]) {
    assert.ok(files.includes(file), file);
  }
  runConsumer(
    directory,
    `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createSourceFilter } from 'swc-plugin-remove-prop-types/source-filter';
const require = createRequire(import.meta.url);
assert.ok(require.resolve('swc-plugin-remove-prop-types').endsWith('plugin.wasm'));
assert.equal(createSourceFilter().test('ordinary'), false);
assert.equal(require('swc-plugin-remove-prop-types/source-filter').createSourceFilter().test('propTypes'), true);
`,
  );
  typecheckConsumer(
    directory,
    `
import type { PluginOptions } from 'swc-plugin-remove-prop-types';
import { createSourceFilter } from 'swc-plugin-remove-prop-types/source-filter';
const sources = ['custom/assert'] as const;
const filter = createSourceFilter({ additionalLibraries: sources });
const options: PluginOptions = filter.options;
createSourceFilter(options);
createSourceFilter(filter.options);
`,
    cwd,
  );
});
