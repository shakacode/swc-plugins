import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('packed package exposes compiled ESM, CommonJS and declaration entrypoints', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'source-filter-package-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const packed = JSON.parse(
    execFileSync(
      'npm',
      ['pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', directory],
      {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, npm_config_cache: path.join(directory, 'cache') },
      },
    ),
  ) as { filename: string; files: { path: string }[] }[];
  const files = packed[0]!.files.map((file) => file.path);
  for (const file of [
    'plugin.wasm',
    'index.d.ts',
    'dist/source-filter.mjs',
    'dist/source-filter.d.mts',
    'dist/default-options.json',
  ]) {
    assert.ok(files.includes(file), file);
  }
  const installed = path.join(directory, 'node_modules/swc-plugin-transform-invariant-warning');
  mkdirSync(installed, { recursive: true });
  execFileSync('tar', [
    '-xf',
    path.join(directory, packed[0]!.filename),
    '--strip-components=1',
    '-C',
    installed,
  ]);
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
