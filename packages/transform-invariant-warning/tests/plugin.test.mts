import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { transformSync, type Options } from '@swc/core';

import type { PluginOptions } from 'swc-plugin-transform-invariant-warning';

const plugin = fileURLToPath(new URL('../plugin.wasm', import.meta.url));

export function compile(source: string, options: PluginOptions = {}) {
  return transformSync(source, {
    filename: 'fixture.ts',
    jsc: {
      parser: { syntax: 'typescript' },
      target: 'es2022',
      experimental: { plugins: [[plugin, options]] },
    },
    module: { type: 'commonjs' },
  }).code;
}

function evaluate(source: string, options: PluginOptions = {}) {
  const calls: unknown[][] = [];
  const fn = (...args: unknown[]) => calls.push(args);
  const exported = { calls };
  const context = {
    exports: exported,
    module: { exports: exported },
    require: () =>
      Object.assign(fn, { __esModule: true, default: fn, warning: fn, invariant: fn, other: fn }),
    warning: fn,
    invariant: fn,
  };
  vm.runInNewContext(compile(source, options), context);
  return JSON.parse(JSON.stringify(context.module.exports)) as { calls: unknown[][] };
}

test('the package runtime entry still resolves to the Wasm artifact', () => {
  const require = createRequire(import.meta.url);
  assert.equal(require.resolve('swc-plugin-transform-invariant-warning'), plugin);
});

test('warning arguments are never evaluated', () => {
  assert.deepEqual(
    evaluate("import warning from 'warning'; warning(false, missing()); exports.done = true;"),
    { calls: [], done: true },
  );
});

test('invariant evaluates its condition once and drops diagnostic arguments', () => {
  assert.deepEqual(
    evaluate(
      "import invariant from 'invariant'; let checks = 0; invariant(checks++, missing()); invariant(++checks, missing()); exports.checks = checks;",
    ),
    { calls: [[false]], checks: 2 },
  );
});

const sources = {
  warning: ['warning', 'tiny-warning', 'fbjs/lib/warning', 'fbjs/lib/warning.js'],
  invariant: ['invariant', 'tiny-invariant', 'fbjs/lib/invariant', 'fbjs/lib/invariant.js'],
};

for (const [kind, packages] of Object.entries(sources)) {
  for (const source of packages) {
    for (const declaration of [
      `import renamed from '${source}';`,
      `import { default as renamed } from '${source}';`,
      `import { ${kind} as renamed } from '${source}';`,
      `const renamed = require('${source}');`,
      `import renamed = require('${source}');`,
    ]) {
      test(`recognizes ${declaration}`, () => {
        assert.deepEqual(
          evaluate(`${declaration} renamed(false, missing());`).calls,
          kind === 'warning' ? [] : [[false]],
        );
      });
    }
  }
}

test('hey-listen named exports are classified by their exported names', () => {
  assert.deepEqual(
    evaluate(
      "import { warning as warn, invariant as check } from 'hey-listen'; warn(false, missing()); check(false, missing());",
    ).calls,
    [[false]],
  );
});

test('overlapping sources leave ambiguous default exports untouched', () => {
  assert.deepEqual(
    evaluate("import warning from 'hey-listen'; warning(false, 'retained');").calls,
    [[false, 'retained']],
  );
});

test('a direct require of an overlapping source remains untouched', () => {
  assert.deepEqual(
    evaluate("const invariant = require('hey-listen'); invariant(false, 'retained');").calls,
    [[false, 'retained']],
  );
});

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
  for (const kind of ['warning', 'invariant']) {
    test(`${kind} preserves an unbraced ${name} body`, () => {
      const code = `let checks = 0; ${body.replace('BODY', `${kind}(true, missing());`)} exports.checks = checks;`;
      assert.deepEqual(evaluate(code), { calls: [], checks });
    });
  }
}

for (const enabled of [true, false]) {
  test(`invariant preserves the outer else (${enabled})`, () => {
    assert.deepEqual(
      evaluate(
        `let checks = 0; if (${enabled}) invariant(++checks, missing()); else exports.fallback = true; exports.checks = checks;`,
      ),
      enabled ? { calls: [], checks: 1 } : { calls: [], fallback: true, checks: 0 },
    );
  });
}

for (const kind of ['warning', 'invariant']) {
  test(`preserves local and shadowed ${kind} bindings`, () => {
    assert.deepEqual(
      evaluate(
        `import ${kind} from '${kind}'; function run(${kind}) { ${kind}(true, 'runtime'); } run((...args) => exports.calls.push(args)); ${kind}(true, missing());`,
      ).calls,
      [[true, 'runtime']],
    );
    assert.deepEqual(
      evaluate(`function ${kind}(value) { exports.calls.push(value); } ${kind}('runtime');`).calls,
      ['runtime'],
    );
    assert.deepEqual(
      evaluate(`const ${kind} = (...args) => exports.calls.push(args); ${kind}('runtime');`).calls,
      [['runtime']],
    );
  });
}

test('preserves block and catch shadows', () => {
  assert.deepEqual(
    evaluate(
      "import warning from 'warning'; { const warning = value => exports.calls.push(value); warning('block'); } try { throw value => exports.calls.push(value); } catch (warning) { warning('catch'); } warning(missing());",
    ).calls,
    ['block', 'catch'],
  );
});

test('preserves unrelated imports, named exports and namespace members', () => {
  assert.deepEqual(
    evaluate(
      "import warning from 'runtime'; warning('runtime'); import { other as invariant } from 'invariant'; import * as helpers from 'hey-listen'; helpers.warning('member');",
    ).calls,
    [['runtime'], ['member']],
  );
  assert.deepEqual(
    evaluate("import { other as warning } from 'warning'; warning(false, 'retained');").calls,
    [[false, 'retained']],
  );
});

test('does not recognize a shadowed require', () => {
  assert.deepEqual(
    evaluate(
      "function run(require) { const warning = require('warning'); warning('runtime'); } run(() => (...args) => exports.calls.push(args));",
    ).calls,
    [['runtime']],
  );
});

test('source overrides replace defaults and permit custom packages', () => {
  assert.deepEqual(
    evaluate(
      "import warning from 'warning'; import custom from 'custom'; warning(false, 'retained'); custom(false, missing());",
      { warningSources: ['custom'] },
    ).calls,
    [[false, 'retained']],
  );
  assert.deepEqual(
    evaluate("import invariant from 'invariant'; invariant(false, 'retained');", {
      invariantSources: [],
    }).calls,
    [[false, 'retained']],
  );
});

test('global rewriting is independently configurable', () => {
  assert.deepEqual(
    evaluate("warning(false, 'retained'); invariant(false, 'retained');", {
      transformGlobals: false,
    }).calls,
    [
      [false, 'retained'],
      [false, 'retained'],
    ],
  );
  assert.deepEqual(
    evaluate("import warning from 'warning'; warning(false, missing());", {
      transformGlobals: false,
    }).calls,
    [],
  );
  assert.deepEqual(evaluate('warning(missing()); invariant(false, missing());').calls, [[false]]);
});

test('preserves calls used as values', () => {
  assert.deepEqual(
    evaluate(
      "exports.result = warning(true, 'value'); function get() { return invariant(true, 'returned'); } get();",
    ).calls,
    [
      [true, 'value'],
      [true, 'returned'],
    ],
  );
});

test('zero-argument invariants and spread-first invariants remain untouched', () => {
  assert.deepEqual(evaluate("invariant(); invariant(...[false, 'spread']);").calls, [
    [],
    [false, 'spread'],
  ]);
});

test('removes optional and generic warning calls', () => {
  assert.deepEqual(evaluate('warning?.(missing()); warning<unknown>(missing());').calls, []);
});

test('preserves optional invariant short-circuiting', () => {
  const code = compile('invariant?.(missing(), missing());');
  vm.runInNewContext(code, { invariant: undefined });
});

test('preserves optional invariant arguments and their evaluation order when defined', () => {
  assert.deepEqual(
    evaluate(`
      const events = [];
      function argument(name, value) { events.push(name); return value; }
      invariant?.(argument('condition', false), argument('message', 'retained'));
      invariant?.(argument('condition', true), argument('message', 'also retained'));
      exports.events = events;
    `),
    {
      calls: [
        [false, 'retained'],
        [true, 'also retained'],
      ],
      events: ['condition', 'message', 'condition', 'message'],
    },
  );
});

test('preserves reassigned require bindings conservatively', () => {
  assert.deepEqual(
    evaluate(
      "let warning = require('warning'); warning = (...args) => exports.calls.push(args); warning('runtime');",
    ).calls,
    [['runtime']],
  );
});

for (const kind of ['warning', 'invariant']) {
  for (const [name, assignment] of [
    ['array destructuring', '[helper] = [runtime];'],
    ['nested destructuring with a default', '[{ value: helper = runtime }] = [{}];'],
    ['array rest destructuring', '[...[helper]] = [runtime];'],
    ['object shorthand with a default', '({ helper = runtime } = {});'],
    ['for-of target', 'for (helper of [runtime]) {}'],
    ['for-of var target', 'for (var helper of [runtime]) {}'],
    ['repeated var initialization', 'var helper = runtime;'],
  ]) {
    test(`preserves ${kind} calls around ${name}`, () => {
      assert.deepEqual(
        evaluate(`
          var helper = require('${kind}');
          const runtime = (...args) => exports.calls.push(args);
          helper(true, 'before');
          ${assignment}
          helper(true, 'after');
        `).calls,
        [
          [true, 'before'],
          [true, 'after'],
        ],
      );
    });
  }

  for (const [name, assignment] of [
    ['update', 'helper++;'],
    ['object rest destructuring', '({ ...helper } = { retained: true });'],
    ['for-in target', 'for (helper in { key: true }) {}'],
  ]) {
    test(`preserves the ${kind} call failure after ${name}`, () => {
      assert.throws(
        () => evaluate(`var helper = require('${kind}'); ${assignment} helper(true, 'retained');`),
        /helper is not a function/,
      );
    });
  }
}

for (const options of [
  { unknown: true },
  { transformGlobals: 'yes' },
  { warningSources: 'warning' },
  { invariantSources: [42] },
  { warningSources: null },
  { transformGlobals: null },
  null,
]) {
  test(`rejects invalid options ${JSON.stringify(options)}`, () => {
    assert.throws(() => compile('warning(false);', options as unknown as PluginOptions));
  });
}

for (const [name, source] of [
  ['ordinary code', '// retained comment\nexport const value: number = 42;'],
  ['local functions', "function warning(value) { return value; } warning('runtime');"],
  ['unrelated imports', "import invariant from 'runtime'; invariant(false, 'retained');"],
  [
    'value-position calls',
    "import warning from 'warning'; export const result = warning(true, 'retained');",
  ],
]) {
  test(`leaves SWC output and maps unchanged for ${name}`, () => {
    const options: Options = {
      filename: 'fixture.ts',
      sourceMaps: true,
      jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
      module: { type: 'commonjs' },
    };
    const baseline = transformSync(source, options);
    const transformed = transformSync(source, {
      ...options,
      jsc: { ...options.jsc, experimental: { plugins: [[plugin, {}]] } },
    });
    assert.equal(transformed.code, baseline.code);
    assert.deepEqual(JSON.parse(transformed.map!), JSON.parse(baseline.map!));
  });
}

// These also exercise the published declaration through TypeScript's package resolution.
const typedOptions: PluginOptions = {
  warningSources: ['warning'],
  invariantSources: ['invariant'],
  transformGlobals: false,
};
void typedOptions;
// @ts-expect-error Source lists contain strings only.
const invalidSources: PluginOptions = { warningSources: [42] };
void invalidSources;
// @ts-expect-error Global rewriting takes a boolean.
const invalidGlobals: PluginOptions = { transformGlobals: 'yes' };
void invalidGlobals;
// @ts-expect-error Unknown options are rejected.
const invalidOption: PluginOptions = { unknown: true };
void invalidOption;
