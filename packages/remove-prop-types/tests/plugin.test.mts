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
function evaluate(
  source: string,
  options: PluginOptions = {},
  modules: Record<string, unknown> = {},
) {
  const loads: string[] = [];
  const types = createTypes();
  const module = { exports: {} };
  vm.runInNewContext(compile(source, options), {
    module,
    exports: module.exports,
    require: (name: string) => {
      loads.push(name);
      return Object.hasOwn(modules, name) ? modules[name] : types;
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

test('keeps standalone validators and checkPropTypes', () => {
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

test('matches additional libraries exactly', () => {
  assert.deepEqual(
    evaluate(
      "import PT from 'custom'; function C(){} C.propTypes={field:PT.string}; exports.done=true;",
      { additionalLibraries: ['custom'] },
    ),
    { value: { done: true }, loads: [] },
  );
  assert.deepEqual(
    evaluate("import PT from 'custom/other'; exports.value=PT.string.isRequired;", {
      additionalLibraries: ['custom'],
    }),
    { value: { value: 'required' }, loads: ['custom/other'] },
  );
});

test('preserves shadowing parameters, blocks, catches and require functions', () => {
  assert.deepEqual(
    evaluate(
      "import PT from 'prop-types'; function run(PT){return PT.string;} exports.local=run({string:42}); {const PT={string:7};exports.block=PT.string;}try{throw {string:9};}catch(PT){exports.caught=PT.string;}exports.required=PT.string.isRequired;",
    ),
    { value: { local: 42, block: 7, caught: 9, required: 'required' }, loads: ['prop-types'] },
  );
  assert.deepEqual(
    evaluate(
      "function run(require){const PT=require('prop-types');return PT.string;}exports.value=run(()=>({string:42}));",
    ).value,
    { value: 42 },
  );
});

test('preserves binding reassignments and writes', () => {
  assert.deepEqual(
    evaluate(
      "let PT = require('prop-types'); const alias = PT; PT.string = 42; exports.value = alias.string;",
    ).value,
    { value: 42 },
  );
});

test(`protects runtime propTypes reads`, () => {
  const result = evaluate(
    "import PT from 'prop-types'; const C = {}; C.propTypes = { field: PT.string }; exports.keys = Object.keys(C.propTypes);",
  );
  assert.deepEqual(result.value, { keys: ['field'] });
  assert.deepEqual(result.loads, ['prop-types']);
});

test(`protects CommonJS exported dictionaries`, () => {
  assert.deepEqual(
    evaluate(
      "import PT from 'prop-types'; exports.propTypes = { field: PT.string }; exports.keys = Object.keys(exports.propTypes);",
    ).value.keys,
    ['field'],
  );
});

test(`protects ESM exported dictionaries`, () => {
  const result = evaluate(
    "import PT from 'prop-types'; export const propTypes = { field: PT.string }; export const keys = Object.keys(propTypes);",
  );
  assert.deepEqual(result.value.keys, ['field']);
  assert.deepEqual(result.loads, ['prop-types']);
});

test('rejects unknown and malformed options', () => {
  for (const options of [
    { unknown: true },
    { removeImport: true },
    { additionalLibraries: false },
    { additionalLibraries: [42] },
  ]) {
    assert.throws(() => compile('', options as PluginOptions));
  }
});

test('deleting a validator invalidates its binding and aliases', () => {
  assert.deepEqual(
    evaluate(
      "const PT = require('prop-types'); const alias = PT; delete alias.string; exports.absent = PT.string === undefined;",
    ).value,
    { absent: true },
  );
});

test('preserves exports aliases created by assignment', () => {
  assert.deepEqual(
    evaluate('let target; target = exports; target.propTypes = { field: 42 };').value,
    { propTypes: { field: 42 } },
  );
});

test('preserves nested exports assignment values', () => {
  assert.deepEqual(
    evaluate('const target = (module.exports = {}); target.propTypes = { field: 42 };').value,
    { propTypes: { field: 42 } },
  );
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
    ).value,
    { value: 42 },
  );
});

test('mutations protect every binding of the same library', () => {
  assert.deepEqual(
    evaluate(
      "const first = require('prop-types'); const second = require('prop-types'); first.string = 42; exports.value = second.string;",
    ).value,
    { value: 42 },
  );
});

test('retains modules that replace Object or require globals', () => {
  assert.deepEqual(
    evaluate(
      "let calls=0; Object.defineProperty=()=>{calls++}; Object.defineProperty({},'propTypes',{}); exports.calls=calls;",
    ).value,
    { calls: 1 },
  );
  assert.deepEqual(
    evaluate(
      "let calls=0; const C={}; require=()=>{calls++;return {}}; const PT=require('prop-types'); C.propTypes={}; exports.calls=calls;",
    ).value,
    { calls: 1 },
  );
});

test('preserves optional validator calls and their arguments', () => {
  assert.deepEqual(
    evaluate(
      "import PT from 'prop-types'; let count = 0; PT.shape?.(++count); exports.count = count;",
    ),
    { value: { count: 1 }, loads: ['prop-types'] },
  );
});

for (const target of ['module?.exports', "module?.['exports']"]) {
  test(`preserves optional CommonJS metadata targets: ${target}`, () => {
    assert.deepEqual(
      evaluate(
        `Object.defineProperty(${target}, 'propTypes', { enumerable: true, value: { field: 42 } });`,
      ),
      { value: { propTypes: { field: 42 } }, loads: [] },
    );
  });
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
      ),
      { value: { value: 42 }, loads: ['prop-types'] },
    );
  });
}

test('optional member aliases protect alias chains and other imports of the same source', () => {
  assert.deepEqual(
    evaluate(
      "import PT, { string } from 'prop-types'; const first = PT?.string; const validate = first; validate.custom = 42; exports.value = string.custom;",
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
    assert.deepEqual(evaluate(`import PT from 'prop-types'; ${declaration}`), {
      value: { propTypes: { field: 'required' } },
      loads: ['prop-types'],
    });
  });
}

test('named metadata function and class exports retain validator values', () => {
  assert.deepEqual(
    evaluate(
      "import PT from 'prop-types'; export function propTypes() { return PT.string; } exports.value = propTypes().isRequired;",
    ),
    { value: { value: 'required' }, loads: ['prop-types'] },
  );
  assert.deepEqual(
    evaluate(
      "import PT from 'prop-types'; export class propTypes { static field = PT.string.isRequired; } exports.value = propTypes.field;",
    ),
    { value: { value: 'required' }, loads: ['prop-types'] },
  );
});

for (const pattern of [
  '{ string: validate } = PT',
  '{ string: validate = missing() } = PT',
  '{ nested: { string: validate } } = { nested: PT }',
  '[validate] = [PT.string]',
]) {
  test(`destructured aliases retain mutation protection: ${pattern}`, () => {
    assert.deepEqual(
      evaluate(
        `const PT = require('prop-types'); const ${pattern}; validate.custom = 42; exports.value = PT.string.custom;`,
      ),
      { value: { value: 42 }, loads: ['prop-types'] },
    );
  });
}

test('unbound validator aliases retain mutation protection', () => {
  assert.deepEqual(
    evaluate(
      "const PT = require('prop-types'); const validate = (0, PT.string); validate.custom = 42; exports.value = PT.string.custom;",
    ),
    { value: { value: 42 }, loads: ['prop-types'] },
  );
});

for (const pattern of [
  '{ validate = PT.string } = {}',
  '[validate = PT.string] = []',
  '{ nested: { validate = PT.string } } = { nested: {} }',
]) {
  test(`destructuring default aliases retain mutation protection: ${pattern}`, () => {
    assert.deepEqual(
      evaluate(
        `const PT = require('prop-types'); const ${pattern}; validate.custom = 42; exports.value = validate.custom;`,
      ),
      { value: { value: 42 }, loads: ['prop-types'] },
    );
  });
}

for (const property of ['.propTypes', "['propTypes']"]) {
  test(`super metadata reads preserve definitions: ${property}`, () => {
    assert.deepEqual(
      evaluate(
        `class Base { static propTypes = { field: 42 }; } class Child extends Base { static schema() { return super${property}; } } exports.keys = Object.keys(Child.schema());`,
      ),
      { value: { keys: ['field'] }, loads: [] },
    );
  });
}

for (const source of [
  'function run({ validate = PT.string } = {}) { validate.custom = 42; return validate.custom; } exports.value = run();',
  'const run = ({ validate = PT.string } = {}) => { validate.custom = 42; return validate.custom; }; exports.value = run();',
  'function run([validate = PT.string] = []) { validate.custom = 42; return validate.custom; } exports.value = run();',
  'function run(validate = PT.string) { validate.custom = 42; return validate.custom; } exports.value = run();',
  'class Container { run({ validate = PT.string } = {}) { validate.custom = 42; return validate.custom; } } exports.value = new Container().run();',
  'class Container { constructor({ validate = PT.string } = {}) { validate.custom = 42; this.value = validate.custom; } } exports.value = new Container().value;',
  'try { throw {}; } catch ({ validate = PT.string }) { validate.custom = 42; exports.value = validate.custom; }',
  'const target = { set value({ validate = PT.string }) { validate.custom = 42; exports.value = validate.custom; } }; target.value = {};',
]) {
  test(`pattern defaults retain mutation protection: ${source}`, () => {
    assert.deepEqual(evaluate(`const PT = require('prop-types'); ${source}`), {
      value: { value: 42 },
      loads: ['prop-types'],
    });
  });
}

for (const assignment of [
  'validate = PT.string;',
  '({ string: validate } = PT);',
  '[validate] = [PT.string];',
  '({ validate = PT.string } = {});',
  'validate ||= PT.string;',
  'validate ??= PT.string;',
  '(validate as unknown) = PT.string;',
]) {
  test(`assigned validator aliases retain mutation protection: ${assignment}`, () => {
    assert.deepEqual(
      evaluate(
        `const PT = require('prop-types'); let validate; ${assignment} validate.custom = 42; exports.value = validate.custom;`,
      ),
      { value: { value: 42 }, loads: ['prop-types'] },
    );
  });
}

test('assigned alias chains protect other imports of the same source', () => {
  assert.deepEqual(
    evaluate(
      "const PT = require('prop-types'); const other = require('prop-types'); let validate; validate = PT.string; const alias = validate; alias.custom = 42; exports.value = other.string.custom;",
    ),
    { value: { value: 42 }, loads: ['prop-types', 'prop-types'] },
  );
});

for (const setup of [
  'interop._ = value => { calls++; return value; };',
  "interop['_'] = value => { calls++; return value; };",
  'const alias = interop; alias._ = value => { calls++; return value; };',
]) {
  test(`modified interop wrappers retain their effects: ${setup}`, () => {
    const helper = (value: unknown) => ({ default: value });
    assert.deepEqual(
      evaluate(
        `import { _ as interop } from '@swc/helpers/_/_interop_require_default'; let calls = 0; ${setup} const PT = interop._(require('prop-types')); exports.calls = calls;`,
        {},
        { '@swc/helpers/_/_interop_require_default': { _: helper } },
      ),
      { value: { calls: 1 }, loads: ['@swc/helpers/_/_interop_require_default', 'prop-types'] },
    );
  });
}

test('modified interop wrappers protect destructured bindings', () => {
  const helper = (value: unknown) => ({ default: value });
  assert.deepEqual(
    evaluate(
      "import { _ as interop } from '@swc/helpers/_/_interop_require_default'; let calls = 0; interop.default = value => { calls++; return value; }; const { string } = interop.default(require('prop-types')); exports.calls = calls;",
      {},
      { '@swc/helpers/_/_interop_require_default': { _: helper } },
    ),
    { value: { calls: 1 }, loads: ['@swc/helpers/_/_interop_require_default', 'prop-types'] },
  );
});

test('standalone validator aliases remain callable', () => {
  assert.deepEqual(
    evaluate("import PT from 'prop-types'; const validate=PT.string; exports.value=validate();"),
    { value: { value: null }, loads: ['prop-types'] },
  );
  assert.deepEqual(
    evaluate(
      "import PT from 'prop-types'; const shape=PT.shape; exports.value=shape().isRequired;",
    ),
    { value: { value: 'required' }, loads: ['prop-types'] },
  );
});

for (const flag of [true, false]) {
  test('conditional validator aliases retain their runtime values ' + flag, () => {
    assert.deepEqual(
      evaluate(
        "import PT from 'prop-types'; const flag=" +
          flag +
          ';const validate=flag?PT.string:PT.number;validate.custom=42;exports.value=validate.custom;',
      ),
      { value: { value: 42 }, loads: ['prop-types'] },
    );
  });
}

test('for-of validator values remain intact', () => {
  assert.deepEqual(
    evaluate(
      "import PT from 'prop-types';for(const validate of [PT.string]){validate.custom=42;exports.value=validate.custom;}",
    ),
    { value: { value: 42 }, loads: ['prop-types'] },
  );
});

test('validator construction retains arguments and sequence effects', () => {
  assert.deepEqual(
    evaluate(
      "import PT from 'prop-types';let count=0;exports.value=(++count,PT.shape?.(++count)).isRequired;exports.count=count;",
    ),
    { value: { value: 'required', count: 2 }, loads: ['prop-types'] },
  );
});

test('interop wrapper calls remain intact even when their result is unused', () => {
  const helper = (value: unknown) => ({ default: value });
  assert.deepEqual(
    evaluate(
      "import { _ as interop } from '@swc/helpers/_/_interop_require_default';const PT=interop(require('prop-types'));exports.done=true;",
      {},
      { '@swc/helpers/_/_interop_require_default': { _: helper } },
    ),
    { value: { done: true }, loads: ['@swc/helpers/_/_interop_require_default', 'prop-types'] },
  );
});

for (const definition of [
  'C.propTypes = receiver.method',
  "Object.defineProperty(receiver.method, 'propTypes', {})",
]) {
  for (const use of [`(${definition})()`, `(${definition})?.()`, `(${definition})\`text\``]) {
    test(`retained function values stay unbound and are read once: ${use}`, () => {
      assert.deepEqual(
        evaluate(
          `const C = {}; let reads = 0; const receiver = { get method() { reads++; return function() { return this === receiver; }; } }; exports.value = ${use}; exports.reads = reads;`,
        ),
        { value: { value: false, reads: 1 }, loads: [] },
      );
    });
  }
}

for (const definition of [
  'C.propTypes = absentName',
  "Object.defineProperty(absentName, 'propTypes', {})",
]) {
  test(`typeof still evaluates an unresolved retained value: ${definition}`, () => {
    assert.throws(() => evaluate(`const C = {}; exports.value = typeof (${definition});`), {
      name: 'ReferenceError',
    });
  });
}

for (const definition of ['C.propTypes = eval', "Object.defineProperty(eval, 'propTypes', {})"]) {
  test(`retained eval values stay indirect: ${definition}`, () => {
    assert.deepEqual(
      evaluate(
        `const C = {}; function run() { const local = 42; return (${definition})('typeof local'); } exports.value = run();`,
      ),
      { value: { value: 'undefined' }, loads: [] },
    );
  });
}

for (const expression of ['() => {}', 'function() {}', 'class { static label = this.name; }']) {
  for (const definition of [
    `C.propTypes = ${expression}`,
    `Object.defineProperty(${expression}, 'propTypes', {})`,
  ]) {
    test(`retained anonymous values do not acquire initializer names: ${definition}`, () => {
      assert.deepEqual(
        evaluate(
          `const C = {}; const value = ${definition}; exports.name = value.name; exports.label = value.label ?? '';`,
        ),
        { value: { name: '', label: '' }, loads: [] },
      );
    });
  }
}
