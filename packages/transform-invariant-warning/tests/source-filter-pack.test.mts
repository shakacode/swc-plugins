import { installPackedPackage } from '@shakacode/swc-plugin-test-utils/package';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
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
  const consumer = path.join(directory, 'consumer.mjs');
  writeFileSync(
    consumer,
    `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createSourceFilter } from 'swc-plugin-transform-invariant-warning/source-filter';
const require = createRequire(import.meta.url);
assert.ok(require.resolve('swc-plugin-transform-invariant-warning').endsWith('plugin.wasm'));
assert.equal(createSourceFilter().test('ordinary'), false);
assert.equal(require('swc-plugin-transform-invariant-warning/source-filter').createSourceFilter().test('invariant'), true);
`,
  );
  execFileSync(process.execPath, [consumer], { cwd: directory, stdio: 'pipe' });
  const typedConsumer = path.join(directory, 'consumer.mts');
  writeFileSync(
    typedConsumer,
    `
import type { PluginOptions } from 'swc-plugin-transform-invariant-warning';
import { createSourceFilter } from 'swc-plugin-transform-invariant-warning/source-filter';
const sources = ['custom/assert'] as const;
const filter = createSourceFilter({ invariantSources: sources });
const options: PluginOptions = filter.options;
createSourceFilter(options);
createSourceFilter(filter.options);
`,
  );
  execFileSync(
    'pnpm',
    [
      'exec',
      'tsc',
      '--ignoreConfig',
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--module',
      'NodeNext',
      '--target',
      'ES2022',
      typedConsumer,
    ],
    { cwd, stdio: 'pipe' },
  );
});
