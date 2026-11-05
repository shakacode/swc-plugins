import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { PluginOptions } from '../index.js';
import { createSourceFilter } from 'swc-plugin-transform-invariant-warning/source-filter';

const context = { allowSkipping: true, watch: false };

test('matches possible default sources independently of call names', () => {
  const filter = createSourceFilter();
  assert.deepEqual(
    filter.options,
    JSON.parse(readFileSync(new URL('../src/default-options.json', import.meta.url), 'utf8')),
  );
  for (const source of [...filter.options.warningSources, ...filter.options.invariantSources]) {
    assert.equal(
      filter.test(`import assertCondition from '${source}'; assertCondition(false);`),
      true,
    );
  }
  assert.equal(filter.test('export const ordinary = () => 42;'), false);
  assert.equal(
    filter.test('export function run() { const assertCondition = require(`invariant`); }'),
    true,
  );
  assert.equal(
    filter.test("import assertCondition from 'invar" + String.fromCharCode(92) + "u0069ant';"),
    true,
  );
  assert.equal(filter.test('// warning in a comment is a conservative false positive'), true);
});

test('replacements and empty source lists agree with guest options', () => {
  const filter = createSourceFilter({ warningSources: [], invariantSources: ['custom/assert'] });
  assert.equal(filter.test("import x from 'invariant';"), false);
  assert.equal(filter.test("import x from 'custom/assert';"), true);
  assert.deepEqual(filter.options, { warningSources: [], invariantSources: ['custom/assert'] });
  assert.equal(
    createSourceFilter({ warningSources: [], invariantSources: [] }).test('ordinary'),
    false,
  );
  assert.equal(createSourceFilter({ warningSources: [''] }).test('ordinary'), true);
});

test('retains cooked static templates whose raw line endings differ', () => {
  const filter = createSourceFilter({ warningSources: [], invariantSources: ['custom\nassert'] });
  for (const ending of ['\r\n', '\r']) {
    const source = 'const assertCondition = require(`custom' + ending + 'assert`);';
    assert.equal(filter.test(source), true);
  }
});

test('keeps host and plugin options stable when caller options change', () => {
  const options = { invariantSources: ['custom/assert'] };
  const filter = createSourceFilter(options);
  options.invariantSources[0] = 'changed';
  assert.equal(filter.test('custom/assert'), true);
  assert.equal(filter.test('changed'), false);
});

test('validates options eagerly even when every file could be skipped', () => {
  for (const value of [
    null,
    [],
    { unknown: true },
    { warningSources: 'warning' },
    { invariantSources: [42] },
    { warningSources: null },
  ]) {
    assert.throws(() => createSourceFilter(value as unknown as PluginOptions));
  }
  assert.deepEqual(
    createSourceFilter({ warningSources: undefined }).options,
    createSourceFilter().options,
  );
});

test('file filtering fails open, checks changing contents, and supports host readers', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'source-filter-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'entry.js');
  const filter = createSourceFilter();
  writeFileSync(filename, 'export const ordinary = 42;');
  assert.equal(filter.testFile(filename, context), false);
  writeFileSync(filename, "import assertCondition from 'invariant'; assertCondition(false);");
  assert.equal(filter.testFile(filename, context), true);
  assert.equal(filter.testFile(path.join(directory, 'missing.js'), context), true);
  assert.equal(
    filter.testFile('virtual.js', { ...context, readSource: () => 'export const ordinary = 42;' }),
    false,
  );
  const readSource = () => {
    throw new Error('reader must not run');
  };
  assert.equal(filter.testFile(filename, { watch: true, allowSkipping: true, readSource }), true);
  assert.equal(filter.testFile(filename, { watch: false, allowSkipping: false, readSource }), true);
});
