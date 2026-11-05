import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { transformSync } from '@swc/core';
import type { PluginOptions } from 'swc-plugin-remove-prop-types';

const plugin = fileURLToPath(new URL('../plugin.wasm', import.meta.url));
function createTypes() {
  const validator = Object.assign(() => null, { isRequired: 'required' });
  return {
    string: validator,
    number: validator,
    shape: () => validator,
    checkPropTypes: () => 'checked',
  };
}

export function compile(source: string, options: PluginOptions = {}) {
  return transformSync(source, {
    filename: 'fixture.tsx',
    jsc: {
      parser: { syntax: 'typescript', tsx: true },
      target: 'es2022',
      experimental: { plugins: [[plugin, options]] },
    },
    module: { type: 'commonjs' },
  }).code;
}

function evaluate(source: string, options: PluginOptions = {}) {
  const loads: string[] = [];
  const types = createTypes();
  const module = { exports: {} };
  vm.runInNewContext(compile(source, options), {
    module,
    exports: module.exports,
    require: (name: string) => {
      loads.push(name);
      return types;
    },
  });
  return { value: JSON.parse(JSON.stringify(module.exports)), loads };
}

test('the package runtime entry resolves to Wasm', () => {
  assert.equal(createRequire(import.meta.url).resolve('swc-plugin-remove-prop-types'), plugin);
});

for (const declaration of [
  "import PT from 'prop-types';",
  "import * as PT from 'prop-types';",
  "import { default as PT } from 'prop-types';",
  "const PT = require('prop-types');",
  "import PT = require('prop-types');",
]) {
  test(`removes definitions and unused dependency: ${declaration}`, () => {
    assert.deepEqual(
      evaluate(
        `${declaration} function C() {} C.propTypes = { value: PT.string, missing: missing() }; exports.done = true;`,
      ),
      { value: { done: true }, loads: [] },
    );
  });
}

for (const [name, body, checks] of [
  ['if', 'if (++checks) BODY', 1],
  ['else', 'if (++checks === 0) throw Error(); else BODY', 1],
  ['while', 'while (checks++ < 2) BODY', 3],
  ['do', 'do BODY while (checks++ < 2);', 3],
  ['for', 'for (; checks++ < 2;) BODY', 3],
  ['for-in', 'for (const key in (++checks, { key: true })) BODY', 1],
  ['for-of', 'for (const value of (++checks, [1, 2])) BODY', 1],
  ['label', 'label: BODY', 0],
] as const) {
  for (const statement of [
    'C.propTypes = missing();',
    'Object.defineProperty(C, "propTypes", missing());',
    'var PT = require("prop-types");',
  ]) {
    test(`preserves unbraced ${name}: ${statement}`, () => {
      assert.deepEqual(
        evaluate(`let checks = 0; ${body.replace('BODY', statement)} exports.checks = checks;`),
        { value: { checks }, loads: [] },
      );
    });
  }
}

test('preserves assignment values and evaluates them once', () => {
  assert.deepEqual(
    evaluate(
      'const C = {}; let calls = 0; const value = C.propTypes = (++calls, { key: 1 }); exports.outcome = { value, calls, keys: Object.keys(C) };',
    ).value,
    { outcome: { value: { key: 1 }, calls: 1, keys: [] } },
  );
});

test('defineProperty in a value context returns its target', () => {
  assert.deepEqual(
    evaluate(
      'const C = {}; const value = Object.defineProperty(C, "propTypes", missing()); exports.same = value === C;',
    ).value,
    { same: true },
  );
});

test('removes static class fields and preserves other static fields', () => {
  assert.deepEqual(
    evaluate(
      'class C { static ["propTypes"] = missing(); static kept = 42; } exports.value = C.kept;',
    ).value,
    { value: 42 },
  );
});

test('keeps standalone validators and checkPropTypes by default', () => {
  assert.deepEqual(
    evaluate(
      "import PT, { checkPropTypes } from 'prop-types'; exports.required = PT.string.isRequired; exports.result = checkPropTypes();",
    ),
    { value: { required: 'required', result: 'checked' }, loads: ['prop-types'] },
  );
});

test('preserves an explicit side-effect import', () => {
  assert.deepEqual(evaluate("import 'prop-types';"), { value: {}, loads: ['prop-types'] });
});

for (const use of [
  'PT.string',
  'PT["string"].isRequired',
  'PT.shape(missing())',
  'PT.shape(missing()).isRequired',
]) {
  test(`aggressive mode strips known validator construction: ${use}`, () => {
    const result = evaluate(`import PT from 'prop-types'; exports.value = ${use};`, {
      removeValidators: true,
    });
    assert.deepEqual(result.loads, []);
    assert.ok(result.value.value === null || result.value.value === undefined);
  });
}

test('aggressive mode recognizes named validators and factories', () => {
  assert.deepEqual(
    evaluate(
      "import { string, shape } from 'prop-types'; exports.value = [string, shape(missing()).isRequired];",
      { removeValidators: true },
    ),
    { value: { value: [null, null] }, loads: [] },
  );
});

test('a retained validator factory alias stays callable', () => {
  assert.deepEqual(
    evaluate("import PT from 'prop-types'; const shape = PT.shape; exports.value = shape();", {
      removeValidators: true,
    }),
    { value: { value: null }, loads: [] },
  );
});

test('matches additional libraries exactly', () => {
  assert.deepEqual(
    evaluate("import PT from 'custom'; exports.value = PT.string;", {
      additionalLibraries: ['custom'],
      removeValidators: true,
    }).loads,
    [],
  );
  assert.deepEqual(
    evaluate("import PT from 'custom/other'; exports.value = PT.string.isRequired;", {
      additionalLibraries: ['custom'],
      removeValidators: true,
    }).value,
    { value: 'required' },
  );
});

test('preserves shadowing parameters, blocks, catches and require functions', () => {
  assert.deepEqual(
    evaluate(
      "import PT from 'prop-types'; function run(PT) { return PT.string; } exports.local = run({ string: 42 }); {const PT = {string: 7}; exports.block = PT.string;} try { throw {string: 9}; } catch (PT) { exports.caught = PT.string; } exports.removed = PT.string;",
      { removeValidators: true },
    ),
    { value: { local: 42, block: 7, caught: 9, removed: null }, loads: [] },
  );
  assert.deepEqual(
    evaluate(
      "function run(require) { const PT = require('prop-types'); return PT.string; } exports.value = run(() => ({ string: 42 }));",
      { removeValidators: true },
    ).value,
    { value: 42 },
  );
});

test('preserves binding reassignments and writes', () => {
  assert.deepEqual(
    evaluate(
      "let PT = require('prop-types'); const alias = PT; PT.string = 42; exports.value = alias.string;",
      { removeValidators: true },
    ).value,
    { value: 42 },
  );
});

for (const options of [{}, { removeValidators: true }]) {
  test(`protects runtime propTypes reads with ${JSON.stringify(options)}`, () => {
    const result = evaluate(
      "import PT from 'prop-types'; const C = {}; C.propTypes = { field: PT.string }; exports.keys = Object.keys(C.propTypes);",
      options,
    );
    assert.deepEqual(result.value, { keys: ['field'] });
    assert.deepEqual(result.loads, ['prop-types']);
  });
  test(`protects CommonJS exported dictionaries with ${JSON.stringify(options)}`, () => {
    assert.deepEqual(
      evaluate(
        "import PT from 'prop-types'; exports.propTypes = { field: PT.string }; exports.keys = Object.keys(exports.propTypes);",
        options,
      ).value.keys,
      ['field'],
    );
  });
  test(`protects ESM exported dictionaries with ${JSON.stringify(options)}`, () => {
    const result = evaluate(
      "import PT from 'prop-types'; export const propTypes = { field: PT.string }; export const keys = Object.keys(propTypes);",
      options,
    );
    assert.deepEqual(result.value.keys, ['field']);
    assert.deepEqual(result.loads, ['prop-types']);
  });
}

test('rejects unknown and malformed options', () => {
  for (const options of [
    { unknown: true },
    { removeImport: true },
    { removeValidators: 'yes' },
    { additionalLibraries: [42] },
  ]) {
    assert.throws(() => compile('', options as PluginOptions));
  }
});

test('aggressive validator invocations do not leave calls to null', () => {
  assert.deepEqual(
    evaluate(
      "import PT from 'prop-types'; PT.string(missing()); PT.string.isRequired(missing()); PT.shape(missing()).isRequired(missing()); exports.done = true;",
      { removeValidators: true },
    ),
    { value: { done: true }, loads: [] },
  );
});

test('deleting a validator invalidates its binding and aliases', () => {
  assert.deepEqual(
    evaluate(
      "const PT = require('prop-types'); const alias = PT; delete alias.string; exports.absent = PT.string === undefined;",
      { removeValidators: true },
    ).value,
    { absent: true },
  );
});

test('preserves exports aliases created by assignment in both modes', () => {
  for (const options of [{}, { removeValidators: true }]) {
    assert.deepEqual(
      evaluate('let target; target = exports; target.propTypes = { field: 42 };', options).value,
      { propTypes: { field: 42 } },
    );
  }
});

test('preserves nested exports assignment values', () => {
  for (const options of [{}, { removeValidators: true }]) {
    assert.deepEqual(
      evaluate('const target = (module.exports = {}); target.propTypes = { field: 42 };', options)
        .value,
      { propTypes: { field: 42 } },
    );
  }
});

test('loop-header aliases retain their dependencies', () => {
  assert.deepEqual(
    evaluate(
      "const PT = require('prop-types'); for (let alias = PT; false;) {} exports.done = true;",
    ).value,
    { done: true },
  );
});

test('unused redeclarations keep unrelated initializer effects', () => {
  assert.deepEqual(
    evaluate(
      "let calls = 0; function record() { calls++; return {}; } var PT = require('prop-types'); var PT = record(); exports.calls = calls;",
    ).value,
    { calls: 1 },
  );
});

test('mutated validator member aliases keep their runtime values', () => {
  assert.deepEqual(
    evaluate(
      "import PT from 'prop-types'; const validate = PT.string; validate.custom = 42; exports.value = validate.custom;",
      { removeValidators: true },
    ).value,
    { value: 42 },
  );
});

test('mutations protect every binding of the same library', () => {
  assert.deepEqual(
    evaluate(
      "const first = require('prop-types'); const second = require('prop-types'); first.string = 42; exports.value = second.string;",
      { removeValidators: true },
    ).value,
    { value: 42 },
  );
});

test('retains modules that replace Object or require globals', () => {
  for (const options of [{}, { removeValidators: true }]) {
    assert.deepEqual(
      evaluate(
        "let calls=0; Object.defineProperty=()=>{calls++}; Object.defineProperty({},'propTypes',{}); exports.calls=calls;",
        options,
      ).value,
      { calls: 1 },
    );
    assert.deepEqual(
      evaluate(
        "let calls=0; const C={}; require=()=>{calls++;return {}}; const PT=require('prop-types'); C.propTypes={}; exports.calls=calls;",
        options,
      ).value,
      { calls: 1 },
    );
  }
});

for (const expression of [
  'PT.shape?.(missing())',
  'PT.shape?.(missing()).isRequired',
  'PT.shape?.(missing())?.isRequired',
  'PT.shape(missing())?.isRequired',
  'PT.shape?.(missing()).isRequired?.(missing())',
  'PT?.shape(missing())',
  'PT?.shape?.(missing())',
  'PT?.shape(missing()).isRequired',
  'PT?.shape?.(missing())?.isRequired',
  'PT.string?.(missing())',
  'PT.string.isRequired?.(missing())',
  'PT?.string.isRequired',
  'PT.string?.isRequired',
]) {
  test(`aggressive optional validator construction drops arguments: ${expression}`, () => {
    const result = evaluate(`import PT from 'prop-types'; exports.value = ${expression};`, {
      removeValidators: true,
    });
    assert.deepEqual(result.loads, []);
    assert.ok(result.value.value === null || result.value.value === undefined);
  });
}

test('aggressive optional named-factory calls drop arguments', () => {
  assert.deepEqual(
    evaluate(
      "import { shape } from 'prop-types'; const renamed = shape; exports.value = renamed?.(missing());",
      { removeValidators: true },
    ),
    { value: {}, loads: [] },
  );
});

test('default mode preserves optional validator calls and their arguments', () => {
  assert.deepEqual(
    evaluate(
      "import PT from 'prop-types'; let count = 0; PT.shape?.(++count); exports.count = count;",
    ),
    { value: { count: 1 }, loads: ['prop-types'] },
  );
});

test('aggressive mode preserves mutated and unknown optional callees', () => {
  assert.deepEqual(
    evaluate(
      "import PT from 'prop-types'; PT.shape = value => value; exports.value = PT.shape?.('retained');",
      { removeValidators: true },
    ),
    { value: { value: 'retained' }, loads: ['prop-types'] },
  );
  assert.deepEqual(
    evaluate('const local = undefined; local?.(missing()); exports.done = true;', {
      removeValidators: true,
    }),
    { value: { done: true }, loads: [] },
  );
});

for (const options of [{}, { removeValidators: true }]) {
  for (const target of ['module?.exports', "module?.['exports']"]) {
    test(`preserves optional CommonJS metadata targets: ${target} ${JSON.stringify(options)}`, () => {
      assert.deepEqual(
        evaluate(
          `Object.defineProperty(${target}, 'propTypes', { enumerable: true, value: { field: 42 } });`,
          options,
        ),
        { value: { propTypes: { field: 42 } }, loads: [] },
      );
    });
  }
}

test('preserves metadata through optional CommonJS aliases and member escapes', () => {
  assert.deepEqual(
    evaluate(
      "const destination = module?.exports; Object.defineProperty(destination, 'propTypes', { enumerable: true, value: { field: 42 } });",
    ),
    { value: { propTypes: { field: 42 } }, loads: [] },
  );
  assert.deepEqual(
    evaluate(
      "exports.child = {}; const destination = exports?.child; Object.defineProperty(destination, 'propTypes', { enumerable: true, value: { field: 42 } });",
    ),
    { value: { child: { propTypes: { field: 42 } } }, loads: [] },
  );
});

test('optional CommonJS metadata protection uses binding identity', () => {
  assert.deepEqual(
    evaluate(
      "const module = { exports: {} }; Object.defineProperty(module?.exports, 'propTypes', missing()); exports.done = true;",
    ),
    { value: { done: true }, loads: [] },
  );
});

for (const initializer of ['PT?.string', 'PT?.shape({})', 'PT.shape?.({})', 'PT?.shape?.({})']) {
  test(`optional member aliases retain mutation protection: ${initializer}`, () => {
    assert.deepEqual(
      evaluate(
        `import PT from 'prop-types'; const validate = ${initializer}; validate.custom = 42; exports.value = validate.custom;`,
        { removeValidators: true },
      ),
      { value: { value: 42 }, loads: ['prop-types'] },
    );
  });
}

test('optional member aliases protect alias chains and other imports of the same source', () => {
  assert.deepEqual(
    evaluate(
      "import PT, { string } from 'prop-types'; const first = PT?.string; const validate = first; validate.custom = 42; exports.value = string.custom;",
      { removeValidators: true },
    ),
    { value: { value: 42 }, loads: ['prop-types'] },
  );
});

for (const declaration of [
  'export const { schema: propTypes } = { schema: { field: PT.string.isRequired } };',
  'export const { outer: { schema: propTypes } } = { outer: { schema: { field: PT.string.isRequired } } };',
  'export const [propTypes] = [{ field: PT.string.isRequired }];',
  'export const { schema: propTypes = { field: PT.string.isRequired } } = {};',
  'export const { ...propTypes } = { field: PT.string.isRequired };',
]) {
  test(`destructured metadata exports retain validator values: ${declaration}`, () => {
    assert.deepEqual(
      evaluate(`import PT from 'prop-types'; ${declaration}`, { removeValidators: true }),
      { value: { propTypes: { field: 'required' } }, loads: ['prop-types'] },
    );
  });
}

test('named metadata function and class exports retain validator values', () => {
  assert.deepEqual(
    evaluate(
      "import PT from 'prop-types'; export function propTypes() { return PT.string; } exports.value = propTypes().isRequired;",
      { removeValidators: true },
    ),
    { value: { value: 'required' }, loads: ['prop-types'] },
  );
  assert.deepEqual(
    evaluate(
      "import PT from 'prop-types'; export class propTypes { static field = PT.string.isRequired; } exports.value = propTypes.field;",
      { removeValidators: true },
    ),
    { value: { value: 'required' }, loads: ['prop-types'] },
  );
});
