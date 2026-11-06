import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSourceFilter, normalizeSourceOptions } from '@shakacode/swc-plugin-utils';

const defaults = { sources: ['default/helper'] };

test('normalizes the options that reach the guest without retaining caller arrays', () => {
  const sources = ['custom/helper'];
  const normalized = normalizeSourceOptions({ sources }, defaults);
  sources.push('later/helper');
  assert.deepEqual(normalized, { sources: ['custom/helper'] });
  assert.deepEqual(normalizeSourceOptions({ sources: undefined }, defaults), defaults);
  assert.deepEqual(normalizeSourceOptions({ toJSON: () => ({ sources: [] }) }, defaults), {
    sources: [],
  });
  for (const options of [null, [], { unknown: [] }, { sources: null }, { sources: [1] }]) {
    assert.throws(() => normalizeSourceOptions(options, defaults), TypeError);
  }
});

test('matches names conservatively and snapshots the matching names', () => {
  const names = ['custom\nhelper'];
  const filter = createSourceFilter({}, names);
  names.push('later');
  assert.equal(filter.test('ordinary'), false);
  assert.equal(filter.test('later'), false);
  assert.equal(filter.test('custom\nhelper'), true);
  assert.equal(filter.test('custom\rhelper'), true);
  assert.equal(filter.test('custom\\u000ahelper'), true);
  assert.equal(createSourceFilter({}, ['']).test('ordinary'), true);
  assert.equal(createSourceFilter({}, []).test('ordinary'), false);
});

test('file filtering requires explicit permission and reads fresh input', () => {
  let source = 'ordinary';
  let reads = 0;
  const readSource = () => {
    reads++;
    return source;
  };
  const filter = createSourceFilter({}, ['helper']);
  assert.equal(filter.testFile('virtual', { watch: true, allowSkipping: true, readSource }), true);
  assert.equal(
    filter.testFile('virtual', { watch: false, allowSkipping: false, readSource }),
    true,
  );
  assert.equal(reads, 0);
  const context = { watch: false, allowSkipping: true, readSource };
  assert.equal(filter.testFile('virtual', context), false);
  source = 'helper';
  assert.equal(filter.testFile('virtual', context), true);
  assert.equal(reads, 2);
  assert.equal(
    filter.testFile('virtual', {
      ...context,
      readSource: () => {
        throw Error('unreadable');
      },
    }),
    true,
  );
});
