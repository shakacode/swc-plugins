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
import { createSourceFilter } from 'swc-plugin-remove-prop-types/source-filter';
import { temporaryDirectory } from '@shakacode/swc-plugin-test-utils/temp-dir';

const plugin = fileURLToPath(new URL('../plugin.wasm', import.meta.url));
const inputs = {
  plain: 'export const value = 42;',
  definition:
    'export function Component() {} Component.propTypes = { value: missing("diagnostic_marker") }; export const value = 1;',
  imported:
    "import PT from 'prop-types'; export function Component() {} Component.propTypes = { value: PT.string }; export const value = 2;",
  escaped:
    "export function Component() {} Component['pr" +
    String.fromCharCode(92) +
    "u006fpTypes'] = { value: missing('diagnostic_marker') }; export const value = 3;",
  enumDefinition:
    "const enum Keys { Target = 'prop' + 'Types' } export function Component() {} Component[Keys.Target] = { value: missing('diagnostic_marker') }; export const value = 6;",
  standalone: "import PT from 'prop-types'; export const value = PT.shape?.({}).isRequired;",
  unused: "const PT = require('prop-types'); export const value = 4;",
  lineEndings: 'const PT = require(`custom\r\nvalidators`); export const value = PT.string;',
  nested: 'export function run() { const PT = require(`custom/validators`); return PT.string; }',
};

function configuration(directory: string, filtered: boolean, watch: boolean) {
  const filter = createSourceFilter({
    additionalLibraries: ['custom/validators', 'custom\nvalidators'],
  });
  return sourceFilterConfiguration({
    directory,
    plugin,
    options: filter.options,
    entries: Object.keys(inputs),
    externals: {
      'prop-types': 'commonjs prop-types',
      'custom/validators': 'commonjs custom/validators',
      'custom\nvalidators': 'commonjs custom\nvalidators',
    },
    filtered,
    shouldTransform: (resource) => filter.testFile(resource, { watch, allowSkipping: true }),
  });
}

for (const { name: endpoint, createCompiler } of rspackHosts) {
  test(`source filter preserves code and maps on ${endpoint} Rspack`, async (t) => {
    const directory = temporaryDirectory(t, 'prop-types-filter-rspack-');
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

  test(`watch retains the guest when a definition is added on ${endpoint} Rspack`, async (t) => {
    const directory = temporaryDirectory(t, 'prop-types-filter-watch-');
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
        await writeFile(filename, inputs.definition);
        return false;
      }
      const value = executeCommonJS(code, {
        require: () => {
          throw new Error('A removed dependency was loaded');
        },
      });
      if (value.value !== 1) {
        return false;
      }
      assert.equal(code.includes('diagnostic_marker'), false);
      assert.equal(code.includes('propTypes'), false);
      return true;
    });
  });
}
