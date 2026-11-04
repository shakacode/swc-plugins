import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import earliest from 'rspack-earliest';
import latest from 'rspack-latest';

const plugin = fileURLToPath(new URL('../plugin.wasm', import.meta.url));
const fixture = `
import PT from 'prop-types';
export function Component() { return 'retained'; }
Component.propTypes = { field: PT.string, nested: PT.shape({ value: PT.number }) };
export const marker = new Error('retained_marker');
`;

for (const endpoint of ['earliest', 'latest'] as const) {
  test(`one Wasm artifact works on the ${endpoint} supported Rspack`, async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'swc-plugin-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(path.join(directory, 'entry.ts'), fixture);
    const config = {
      context: directory,
      mode: 'production',
      target: 'node',
      entry: './entry.ts',
      devtool: 'source-map',
      optimization: { minimize: false },
      output: {
        path: path.join(directory, 'dist'),
        filename: 'bundle.cjs',
        library: { type: 'commonjs2' },
      },
      externals: { 'prop-types': 'commonjs prop-types' },
      module: {
        rules: [
          {
            test: /\.ts$/,
            loader: 'builtin:swc-loader',
            options: {
              jsc: {
                parser: { syntax: 'typescript' },
                target: 'es2022',
                experimental: { plugins: [[plugin, {}]] },
              },
            },
          },
        ],
      },
    } satisfies import('rspack-earliest').Configuration & import('rspack-latest').Configuration;
    const compiler = endpoint === 'earliest' ? earliest.rspack(config) : latest.rspack(config);
    await new Promise<void>((resolve, reject) => {
      compiler.run((error, stats) => {
        compiler.close((closeError) => {
          if (error || closeError) {
            reject(error || closeError);
          } else if (!stats) {
            reject(new Error('Rspack did not return build statistics'));
          } else if (stats.hasErrors()) {
            reject(new Error(stats.toString({ all: false, errors: true })));
          } else {
            resolve();
          }
        });
      });
    });
    const code = await readFile(path.join(directory, 'dist/bundle.cjs'), 'utf8');
    const module = { exports: {} as Record<string, unknown> };
    vm.runInNewContext(code, {
      module,
      exports: module.exports,
      require: () => {
        throw new Error('Unused validator dependency was loaded');
      },
    });
    const component = module.exports.Component as (() => string) & { propTypes?: unknown };
    assert.equal(component(), 'retained');
    assert.equal(component.propTypes, undefined);
    assert.ok(!code.includes('prop-types'), 'validator dependency should leave the bundle');

    const map = new TraceMap(
      JSON.parse(await readFile(path.join(directory, 'dist/bundle.cjs.map'), 'utf8')),
    );
    const generatedOffset = code.indexOf('retained_marker');
    assert.ok(generatedOffset >= 0);
    const before = code.slice(0, generatedOffset).split('\n');
    const original = originalPositionFor(map, {
      line: before.length,
      column: before.at(-1)!.length,
    });
    assert.equal(
      original.line,
      fixture.slice(0, fixture.indexOf('retained_marker')).split('\n').length,
    );
    assert.ok(original.source);
    assert.ok(original.source.endsWith('entry.ts'), original.source);
    assert.ok(map.sourcesContent?.includes(fixture));
  });
}
