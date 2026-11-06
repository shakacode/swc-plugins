import { executeCommonJS } from '@shakacode/swc-plugin-test-utils/plugin';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  rspackHosts,
  runCompiler,
  sourceFilterConfiguration,
  readBuildOutputs,
  watchCompiler,
} from '@shakacode/swc-plugin-test-utils/rspack';
import { createSourceFilter } from 'swc-plugin-transform-invariant-warning/source-filter';
import { temporaryDirectory } from '@shakacode/swc-plugin-test-utils/temp-dir';

const plugin = fileURLToPath(new URL('../plugin.wasm', import.meta.url));
const inputs = {
  plain: 'export const value = 42;',
  alias:
    "import assertCondition from 'invariant'; assertCondition(globalThis.condition, 'diagnostic_marker'); export const value = 1;",
  escaped:
    "import assertCondition from 'invar" +
    String.fromCharCode(92) +
    "u0069ant'; assertCondition(globalThis.condition, 'diagnostic_marker'); export const value = 2;",
  lineEndings:
    'const assertCondition = require(`custom\r\nassert`); assertCondition(globalThis.condition, "diagnostic_marker"); export const value = 3;',
  nested:
    'export function run() { const assertCondition = require(`custom/assert`); assertCondition(globalThis.condition, "diagnostic_marker"); }',
};

function configuration(directory: string, filtered: boolean, watch: boolean) {
  const filter = createSourceFilter({
    invariantSources: ['invariant', 'custom/assert', 'custom\nassert'],
  });
  return sourceFilterConfiguration({
    directory,
    plugin,
    options: filter.options,
    entries: Object.keys(inputs),
    externals: {
      invariant: 'commonjs invariant',
      'custom/assert': 'commonjs custom/assert',
      'custom\nassert': 'commonjs custom\nassert',
    },
    filtered,
    shouldTransform: (resource) => filter.testFile(resource, { watch, allowSkipping: true }),
  });
}

for (const { name: endpoint, createCompiler } of rspackHosts) {
  test(`source filter preserves code and maps on ${endpoint} Rspack`, async (t) => {
    const directory = temporaryDirectory(t, 'source-filter-rspack-');
    for (const [name, source] of Object.entries(inputs)) {
      await writeFile(path.join(directory, `${name}.ts`), source);
    }
    async function build(filtered: boolean): Promise<Record<string, string>> {
      const config = configuration(directory, filtered, false);
      await runCompiler(createCompiler(config));
      return readBuildOutputs(path.join(directory, 'out'));
    }
    const baseline = await build(false);
    const filtered = await build(true);
    assert.deepEqual(filtered, baseline);
    for (const [name, code] of Object.entries(filtered)) {
      if (name.endsWith('.cjs')) {
        assert.equal(code.includes('diagnostic_marker'), false);
      }
    }
  });

  test(`watch retains the guest when an import is added on ${endpoint} Rspack`, async (t) => {
    const directory = temporaryDirectory(t, 'source-filter-watch-');
    const filename = path.join(directory, 'plain.ts');
    await writeFile(filename, inputs.plain);
    const config = { ...configuration(directory, true, true), entry: './plain.ts' };
    const compiler = createCompiler(config);
    let requestedUpdate = false;
    await watchCompiler(compiler, async () => {
      const code = await readFile(path.join(directory, 'out/main.cjs'), 'utf8');
      if (!requestedUpdate) {
        requestedUpdate = true;
        assert.equal(code.includes('diagnostic_marker'), false);
        await writeFile(filename, inputs.alias);
        return false;
      }
      const value = executeCommonJS(code, { require: () => () => {} });
      if (value.value !== 1) {
        return false;
      }
      assert.equal(code.includes('diagnostic_marker'), false);
      assert.match(code, /invariant/);
      return true;
    });
  });
}
