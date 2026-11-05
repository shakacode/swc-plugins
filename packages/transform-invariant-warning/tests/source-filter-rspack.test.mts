import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import earliest from 'rspack-earliest';
import latest from 'rspack-latest';
import { createSourceFilter } from 'swc-plugin-transform-invariant-warning/source-filter';

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
      invariant: 'commonjs invariant',
      'custom/assert': 'commonjs custom/assert',
      'custom\nassert': 'commonjs custom\nassert',
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
  } satisfies import('rspack-earliest').Configuration & import('rspack-latest').Configuration;
}

for (const [endpoint] of [
  ['earliest', earliest],
  ['latest', latest],
] as const) {
  test(`source filter preserves code and maps on ${endpoint} Rspack`, async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'source-filter-rspack-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    for (const [name, source] of Object.entries(inputs)) {
      await writeFile(path.join(directory, `${name}.ts`), source);
    }
    async function build(filtered: boolean): Promise<Record<string, string>> {
      const config = configuration(directory, filtered, false);
      const compiler = endpoint === 'earliest' ? earliest.rspack(config) : latest.rspack(config);
      await new Promise<void>((resolve, reject) =>
        compiler.run((error, stats) => {
          compiler.close((closeError) => {
            if (error || closeError || !stats || stats.hasErrors()) {
              reject(
                error ||
                  closeError ||
                  new Error(stats?.toString({ all: false, errors: true }) || 'Missing stats'),
              );
            } else {
              resolve();
            }
          });
        }),
      );
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

  test(`watch retains the guest when an import is added on ${endpoint} Rspack`, async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'source-filter-watch-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const filename = path.join(directory, 'plain.ts');
    await writeFile(filename, inputs.plain);
    const config = { ...configuration(directory, true, true), entry: './plain.ts' };
    const compiler = endpoint === 'earliest' ? earliest.rspack(config) : latest.rspack(config);
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
              await writeFile(filename, inputs.alias);
            } else {
              const module = { exports: {} as Record<string, unknown> };
              vm.runInNewContext(code, {
                module,
                exports: module.exports,
                require: () => () => {},
              });
              if (module.exports.value !== 1) {
                return;
              }
              assert.equal(code.includes('diagnostic_marker'), false);
              assert.match(code, /invariant/);
              finish();
            }
          })().catch(finish);
        });
      });
    } finally {
      if (watching) {
        await new Promise<void>((resolve) => watching!.close(resolve));
      }
      await new Promise<void>((resolve, reject) =>
        compiler.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}
