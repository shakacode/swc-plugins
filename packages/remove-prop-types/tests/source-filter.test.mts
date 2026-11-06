import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { transformSync } from '@swc/core';
import { temporaryDirectory } from '@shakacode/swc-plugin-test-utils/temp-dir';
import type { PluginOptions } from 'swc-plugin-remove-prop-types';
import { createSourceFilter } from 'swc-plugin-remove-prop-types/source-filter';

const plugin = fileURLToPath(new URL('../plugin.wasm', import.meta.url));
const context = { watch: false, allowSkipping: true };

test('keeps definitions and validator imports eligible independently', () => {
  const filter = createSourceFilter();
  assert.deepEqual(
    filter.options,
    JSON.parse(readFileSync(new URL('../src/default-options.json', import.meta.url), 'utf8')),
  );
  for (const source of [
    'Component.propTypes = { value: missing() };',
    'class Component { static propTypes = {}; }',
    "Object.defineProperty(Component, 'propTypes', descriptor);",
    "import PT from 'prop-types'; export const value = 1;",
    "const PT = require('prop-types'); export const value = 1;",
  ]) {
    assert.equal(filter.test(source), true, source);
  }
  assert.equal(filter.test('export const ordinary = 42;'), false);
});

test('additional libraries extend eligibility without replacing built-in matching', () => {
  const filter = createSourceFilter({ additionalLibraries: ['custom/validators'] });
  assert.equal(
    filter.test("const PT = require('custom/validators'); export const value = 1;"),
    true,
  );
  assert.equal(filter.test("import PT from 'prop-types';"), true);
  assert.equal(filter.test('Component.propTypes = {};'), true);
  assert.equal(createSourceFilter({ additionalLibraries: [''] }).test('ordinary'), true);
});

test('retains escaped names and cooked static-template line endings', () => {
  const filter = createSourceFilter({ additionalLibraries: ['custom\nvalidators'] });
  assert.equal(
    filter.test("Component['pr" + String.fromCharCode(92) + "u006fpTypes'] = {};"),
    true,
  );
  for (const ending of ['\r\n', '\r']) {
    assert.equal(filter.test('const PT = require(`custom' + ending + 'validators`);'), true);
  }
});

test('normalizes defaults and snapshots caller options once', () => {
  const options = { additionalLibraries: ['custom/validators'] };
  const filter = createSourceFilter(options);
  options.additionalLibraries[0] = 'changed';
  assert.deepEqual(filter.options, {
    additionalLibraries: ['custom/validators'],
  });
  assert.equal(filter.test('custom/validators'), true);
  assert.equal(filter.test('changed'), false);
  assert.deepEqual(
    createSourceFilter({ additionalLibraries: undefined }).options,
    createSourceFilter().options,
  );
});

test('rejects invalid options before any file can bypass the guest', () => {
  for (const value of [
    null,
    [],
    { unknown: true },
    { additionalLibraries: null },
    { additionalLibraries: 'custom' },
    { additionalLibraries: [42] },
  ]) {
    assert.throws(() => createSourceFilter(value as unknown as PluginOptions));
  }
});

test('file filtering fails open and uses current content and explicit host state', (t) => {
  const directory = temporaryDirectory(t, 'prop-types-source-filter-');
  const filename = path.join(directory, 'entry.js');
  const filter = createSourceFilter();
  writeFileSync(filename, 'export const ordinary = 42;');
  assert.equal(filter.testFile(filename, context), false);
  writeFileSync(filename, 'Component.propTypes = {};');
  assert.equal(filter.testFile(filename, context), true);
  assert.equal(filter.testFile(path.join(directory, 'missing.js'), context), true);
  assert.equal(filter.testFile('virtual.js', { ...context, readSource: () => 'ordinary' }), false);
  assert.equal(
    filter.testFile('virtual.js', {
      ...context,
      readSource: () => {
        throw new Error('unreadable');
      },
    }),
    true,
  );
  const readSource = () => {
    throw new Error('ineligible readers must not run');
  };
  assert.equal(filter.testFile(filename, { watch: true, allowSkipping: true, readSource }), true);
  assert.equal(filter.testFile(filename, { watch: false, allowSkipping: false, readSource }), true);
});

const fixtures: { name: string; source: string; options?: PluginOptions }[] = [
  { name: 'plain input', source: 'export const value = 42;' },
  {
    name: 'unrelated require',
    source: "const library = require('another-library'); export const value = library.string;",
  },
  {
    name: 'definition without imports',
    source: 'export function Component() {} Component.propTypes = { value: missing() };',
  },
  {
    name: 'escaped property without imports',
    source:
      "export function Component() {} Component['pr" +
      String.fromCharCode(92) +
      "u006fpTypes'] = { value: missing() };",
  },
  {
    name: 'static class field',
    source: "export class Component { static ['propTypes'] = { value: missing() }; }",
  },
  {
    name: 'unused require without definitions',
    source: "const PT = require('prop-types'); export const value = 42;",
  },
  {
    name: 'custom library without definitions',
    source: "const PT = require('custom/validators'); export const value = 42;",
    options: { additionalLibraries: ['custom/validators'] },
  },
  {
    name: 'standalone validator',
    source: "const PT = require('custom/validators'); export const value = PT.string;",
    options: { additionalLibraries: ['custom/validators'] },
  },
  {
    name: 'CRLF template source',
    source: 'const PT = require(`custom\r\nvalidators`); export const value = PT.string;',
    options: { additionalLibraries: ['custom\nvalidators'] },
  },
  {
    name: 'CR template source',
    source: 'const PT = require(`custom\rvalidators`); export const value = 42;',
    options: { additionalLibraries: ['custom\nvalidators'] },
  },
  {
    name: 'enum-constructed property',
    source:
      "const enum Keys { Target = 'prop' + 'Types' } export function Component() {} Component[Keys.Target] = { value: missing() };",
  },
  {
    name: 'enum-constructed library source',
    source:
      "const enum Libraries { Target = 'prop' + '-types' } const PT = require(Libraries.Target); export const value = 42;",
  },
  {
    name: 'runtime metadata protection',
    source:
      "import PT from 'prop-types'; function Component() {} Component.propTypes = { value: PT.string }; export const fields = Object.keys(Component.propTypes);",
  },
];
for (const { name, source, options } of fixtures) {
  test(`filter preserves SWC code and source maps for ${name}`, () => {
    const filter = createSourceFilter(options);
    function compile(enabled: boolean) {
      return transformSync(source, {
        filename: 'fixture.tsx',
        sourceMaps: true,
        jsc: {
          parser: { syntax: 'typescript', tsx: true },
          target: 'es2022',
          experimental: { plugins: enabled ? [[plugin, filter.options]] : [] },
        },
        module: { type: 'es6' },
      });
    }
    const baseline = compile(true);
    const filtered = compile(filter.test(source));
    assert.equal(filtered.code, baseline.code);
    assert.equal(filtered.map, baseline.map);
  });
}
