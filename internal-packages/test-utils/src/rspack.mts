import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { temporaryDirectory } from './temp-dir.mts';
import earliest from 'rspack-earliest';
import latest from 'rspack-latest';

export type RspackConfiguration = import('rspack-earliest').Configuration &
  import('rspack-latest').Configuration;
export type RspackCompiler = import('rspack-earliest').Compiler | import('rspack-latest').Compiler;

export const rspackHosts = [
  {
    name: 'earliest',
    createCompiler: (config: RspackConfiguration) => earliest.rspack(config),
  },
  {
    name: 'latest',
    createCompiler: (config: RspackConfiguration) => latest.rspack(config),
  },
] as const;

export function runCompiler(compiler: RspackCompiler): Promise<void> {
  return new Promise((resolve, reject) => {
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
}

export function closeCompiler(compiler: RspackCompiler): Promise<void> {
  return new Promise((resolve, reject) => {
    compiler.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function buildPluginFixture(
  t: TestContext,
  fixture: {
    createCompiler: (config: RspackConfiguration) => RspackCompiler;
    plugin: string;
    source: string;
    externals: Record<string, string>;
  },
) {
  const directory = temporaryDirectory(t, 'swc-plugin-rspack-');
  await writeFile(path.join(directory, 'entry.ts'), fixture.source);
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
    externals: fixture.externals,
    module: {
      rules: [
        {
          test: /\.ts$/,
          loader: 'builtin:swc-loader',
          options: {
            jsc: {
              parser: { syntax: 'typescript' },
              target: 'es2022',
              experimental: { plugins: [[fixture.plugin, {}]] },
            },
          },
        },
      ],
    },
  } satisfies RspackConfiguration;
  await runCompiler(fixture.createCompiler(config));
  const code = await readFile(path.join(directory, 'dist/bundle.cjs'), 'utf8');
  const map = new TraceMap(
    JSON.parse(await readFile(path.join(directory, 'dist/bundle.cjs.map'), 'utf8')),
  );
  return { code, map };
}

export function assertSourceMapping(
  code: string,
  map: TraceMap,
  source: string,
  marker: string,
  filename = 'entry.ts',
): void {
  const generatedOffset = code.indexOf(marker);
  assert.ok(generatedOffset >= 0, 'marker must remain in generated code');
  const sourceOffset = source.indexOf(marker);
  assert.ok(sourceOffset >= 0, 'marker must exist in the fixture');
  const before = code.slice(0, generatedOffset).split('\n');
  const original = originalPositionFor(map, { line: before.length, column: before.at(-1)!.length });
  assert.equal(original.line, source.slice(0, sourceOffset).split('\n').length);
  assert.ok(original.source?.endsWith(filename), original.source ?? 'missing original source');
  assert.ok(map.sourcesContent?.includes(source));
}
