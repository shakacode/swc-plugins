import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  rspackHosts,
  runCompiler,
  closeCompiler,
  type RspackConfiguration,
} from '@swc-plugins/test-utils/rspack';
import { createSourceFilter } from 'swc-plugin-remove-prop-types/source-filter';
import { temporaryDirectory } from '@swc-plugins/test-utils/temp-dir';

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
  unused: "const PT = require('prop-types'); export const value = 4;",
  lineEndings: 'const PT = require(`custom\r\nvalidators`); export const value = PT.string;',
  nested: 'export function run() { const PT = require(`custom/validators`); return PT.string; }',
};

function configuration(directory: string, filtered: boolean, watch: boolean) {
  const filter = createSourceFilter({
    removeValidators: true,
    additionalLibraries: ['custom/validators', 'custom\nvalidators'],
  });
  const plain = { jsc: { parser: { syntax: 'typescript' as const }, target: 'es2022' as const } };
  const transformed = {
    jsc: {
      ...plain.jsc,
      experimental: { plugins: [[plugin, filter.options] as [string, typeof filter.options]] },
    },
  };
  return {
    context: directory,
    mode: 'production' as const,
    target: 'node',
    entry: Object.fromEntries(Object.keys(inputs).map((name) => [name, `./${name}.ts`])),
    devtool: 'source-map' as const,
    optimization: { minimize: false },
    output: {
      path: path.join(directory, 'out'),
      filename: '[name].cjs',
      library: { type: 'commonjs2' },
    },
    externals: {
      'prop-types': 'commonjs prop-types',
      'custom/validators': 'commonjs custom/validators',
      'custom\nvalidators': 'commonjs custom\nvalidators',
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          oneOf: [
            {
              resource: (resource: string) =>
                filter.testFile(resource, { watch, allowSkipping: true }),
              use: [{ loader: 'builtin:swc-loader', options: transformed }],
            },
            { use: [{ loader: 'builtin:swc-loader', options: filtered ? plain : transformed }] },
          ],
        },
      ],
    },
  } satisfies RspackConfiguration;
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
      const names = (await readdir(path.join(directory, 'out'))).sort();
      return Object.fromEntries(
        await Promise.all(
          names.map(
            async (name) =>
              [name, await readFile(path.join(directory, 'out', name), 'utf8')] as const,
          ),
        ),
      );
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
    let watching: ReturnType<typeof compiler.watch> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        let requestedUpdate = false;
        let finished = false;
        const timeout = setTimeout(() => finish(new Error('Watch rebuild timed out')), 20000);
        function finish(error?: Error) {
          if (finished) {
            return;
          }
          finished = true;
          clearTimeout(timeout);
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        }
        watching = compiler.watch({ poll: 50, aggregateTimeout: 10 }, (error, stats) => {
          if (finished) {
            return;
          }
          if (error || !stats || stats.hasErrors()) {
            finish(
              error || new Error(stats?.toString({ all: false, errors: true }) || 'Missing stats'),
            );
            return;
          }
          void (async () => {
            const code = await readFile(path.join(directory, 'out/main.cjs'), 'utf8');
            if (!requestedUpdate) {
              requestedUpdate = true;
              assert.equal(code.includes('diagnostic_marker'), false);
              await writeFile(filename, inputs.definition);
            } else {
              const module = { exports: {} as Record<string, unknown> };
              vm.runInNewContext(code, {
                module,
                exports: module.exports,
                require: () => {
                  throw new Error('A removed dependency was loaded');
                },
              });
              if (module.exports.value !== 1) {
                return;
              }
              assert.equal(code.includes('diagnostic_marker'), false);
              assert.equal(code.includes('propTypes'), false);
              finish();
            }
          })().catch(finish);
        });
      });
    } finally {
      if (watching) {
        await new Promise<void>((resolve) => watching!.close(resolve));
      }
      await closeCompiler(compiler);
    }
  });
}
