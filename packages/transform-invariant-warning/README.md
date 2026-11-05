# swc-plugin-transform-invariant-warning

[Changelog](CHANGELOG.md)

An SWC Wasm transform that removes warning calls and strips
invariant diagnostic arguments while retaining invariant failures.

Enable it only for production builds; omit it in development and tests.

Inspired by the [babel-plugin-dev-expression](https://github.com/4Catalyzer/babel-plugin-dev-expression) Babel plugin.
Unlike it, we do not rewrite `__DEV__`; if you want to do that, see [below](#defining-__dev__).

## Hosts

Install the plugin:

```sh
pnpm add -D swc-plugin-transform-invariant-warning
```

### Rspack

This plugin supports Rspack `>=2.2.0 <3.0.0` through `builtin:swc-loader`.

```js
import { createRequire } from 'node:module';
import { rspack } from '@rspack/core';

const require = createRequire(import.meta.url);
const production = process.env.NODE_ENV === 'production';

export default {
  mode: production ? 'production' : 'development',
  plugins: [new rspack.DefinePlugin({ __DEV__: !production })],
  module: {
    rules: [
      {
        test: /\.[cm]?[jt]sx?$/,
        exclude: /node_modules/,
        loader: 'builtin:swc-loader',
        options: {
          jsc: {
            parser: { syntax: 'typescript', tsx: true },
            experimental: {
              plugins: production
                ? [[require.resolve('swc-plugin-transform-invariant-warning'), {}]]
                : [],
            },
          },
        },
      },
    ],
  },
};
```

### SWC CLI

This plugin supports `@swc/core` `>=1.16.0 <2.0.0`. The CLI example is tested
with `@swc/cli` `0.8.2`.

Create `.swcrc.production.json` for the [SWC CLI](https://swc.rs/docs/usage/cli):

```json
{
  "jsc": {
    "parser": { "syntax": "typescript", "tsx": true },
    "experimental": {
      "plugins": [["swc-plugin-transform-invariant-warning", {}]]
    },
    "transform": {
      "optimizer": {
        "globals": { "vars": { "__DEV__": "false" } }
      }
    }
  }
}
```

Use this configuration only for production builds:

```sh
pnpm exec swc src --out-dir dist --config-file .swcrc.production.json
```

## Optional source filter

Use the helper to skip the plugin for files without supported imports or requires.
It accepts the [same options](#options) as the plugin.

This production Rspack CLI example processes source files directly. Run it with
`rspack build` or `rspack build --watch`; `--watch` keeps the plugin enabled
for all files:

```ts
import { createRequire } from 'node:module';
import type { Configuration, SwcLoaderOptions } from '@rspack/core';
import { createSourceFilter } from 'swc-plugin-transform-invariant-warning/source-filter';

const require = createRequire(import.meta.url);

export default (_env: unknown, argv: { watch?: boolean }) => {
  const watch = Boolean(argv.watch);
  const filter = createSourceFilter();
  const plain: SwcLoaderOptions = {
    jsc: { parser: { syntax: 'typescript', tsx: true } },
  };
  const transformed: SwcLoaderOptions = {
    ...plain,
    jsc: {
      ...plain.jsc,
      experimental: {
        plugins: [[require.resolve('swc-plugin-transform-invariant-warning'), filter.options]],
      },
    },
  };
  return {
    mode: 'production',
    watch,
    module: {
      rules: [
        {
          test: /\.[cm]?[jt]sx?$/,
          oneOf: [
            {
              resource: (resource) => filter.testFile(resource, { watch, allowSkipping: true }),
              use: [{ loader: 'builtin:swc-loader', options: transformed }],
            },
            { use: [{ loader: 'builtin:swc-loader', options: plain }] },
          ],
        },
      ],
    },
  } satisfies Configuration;
};
```

Pass `filter.options` to the plugin without modifying them, as shown above.
`filter.testFile` returns
`true` when the plugin may be needed. Read failures keep the plugin enabled.

Skipping requires `watch: false` and `allowSkipping: true`. When using Rspack's
JavaScript API with `compiler.watch()`, pass `watch: true` to `filter.testFile`.

Set `allowSkipping: false` if earlier loaders or transforms could introduce
supported imports or requires. This also applies to inline loaders and other
matching rules. Place this plugin first when combining Wasm plugins.

For virtual files or a custom filesystem, supply
`readSource: (filename: string) => string` in the file context. If your host
already has the actual compiler input, use `filter.test(source)` directly;
`false` means it can skip the plugin.

## Rewrites

```js
import warning from 'warning';
import invariant from 'invariant';

warning(condition, expensiveMessage());
invariant(condition, expensiveMessage());
```

becomes:

```js
import warning from 'warning';
import invariant from 'invariant';
{
  if (!condition) {
    invariant(false);
  }
}
```

Warning arguments are not evaluated. An invariant condition is evaluated once;
diagnostic arguments are not evaluated. Imports are retained for the host's
normal tree shaking.

Only calls written as standalone statements, such as
`invariant(condition, message);`, are rewritten.

Optional warning calls, such as
`warning?.(condition, message)`, are removed as well.

What remains unchanged:

- Calls used as values: `return invariant(condition, message)` or
  `const result = invariant(condition, message)`.
- Member calls, including namespace calls: `helpers.invariant(condition, message)`.
- Invariant calls with no arguments or a spread as their first argument.
- Optional invariant calls: `invariant?.(condition, message)`, to preserve their
  conditional evaluation.
- Destructured `require` bindings.
- Calls to unresolved globals, local functions, or parameters.
- Calls through shadowed bindings or helpers loaded by a shadowed `require`.
- Calls through type-only imports or imports from unconfigured sources.
- Calls through bindings reassigned anywhere in the file.

See the [transformation tests](https://github.com/shakacode/swc-plugins/blob/main/packages/transform-invariant-warning/tests/plugin.test.mts)
for more examples.

## Default sources

| Package                                                         | Warning sources                           | Invariant sources                             |
| --------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------- |
| [warning](https://github.com/BerkeleyTrue/warning)              | `warning`                                 |                                               |
| [tiny-warning](https://github.com/alexreardon/tiny-warning)     | `tiny-warning`                            |                                               |
| [invariant](https://github.com/zertosh/invariant)               |                                           | `invariant`                                   |
| [tiny-invariant](https://github.com/alexreardon/tiny-invariant) |                                           | `tiny-invariant`                              |
| [fbjs](https://github.com/facebook/fbjs)                        | `fbjs/lib/warning`, `fbjs/lib/warning.js` | `fbjs/lib/invariant`, `fbjs/lib/invariant.js` |
| [hey-listen](https://github.com/Popmotion/hey-listen)           | `hey-listen`                              | `hey-listen`                                  |

Sources match exact module specifiers. For each kind, the default export and
the corresponding named export (`warning` or `invariant`) are recognized.
Renaming either import is supported:

```js
import { warning as warn, invariant as assert } from 'hey-listen';
```

A source may appear in both lists. Its named exports remain unambiguous; its
default export, direct `require`, and import-equals bindings are left unchanged.

## Options

Import the options type in TypeScript:

```ts
import type { PluginOptions } from 'swc-plugin-transform-invariant-warning';

const options = { invariantSources: ['tiny-invariant'] } satisfies PluginOptions;
```

- `warningSources` and `invariantSources` **replace** their respective defaults.
  An empty array disables recognition of that kind through imports and requires.
- Unknown options and invalid option types produce errors.

[ts-invariant](https://github.com/apollographql/invariant-packages/tree/main/packages/ts-invariant)
is opt-in. Its numeric diagnostic codes may be intentional production information;
this transform discards them along with other diagnostic arguments. If that is
desired, add it to `invariantSources`:

```json
{
  "invariantSources": [
    "invariant",
    "tiny-invariant",
    "fbjs/lib/invariant",
    "fbjs/lib/invariant.js",
    "hey-listen",
    "ts-invariant"
  ]
}
```

## Defining `__DEV__`

This plugin does not replace `__DEV__`. If your application or its dependencies
use `__DEV__`, define it in your build and test configuration. The build examples below
assume a `production` boolean, defined for example as:

```js
const production = process.env.NODE_ENV === 'production';
```

| Tool           | Configuration                                                                                        | Documentation                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Rspack         | `plugins: [new rspack.DefinePlugin({ __DEV__: !production })]`                                       | [DefinePlugin](https://rspack.dev/plugins/define-plugin)                                        |
| webpack        | `plugins: [new webpack.DefinePlugin({ __DEV__: !production })]`                                      | [DefinePlugin](https://webpack.js.org/plugins/define-plugin/)                                   |
| Vite           | `define: { __DEV__: !production }`                                                                   | [define](https://vite.dev/config/shared-options.html#define)                                    |
| esbuild        | `define: { __DEV__: JSON.stringify(!production) }`                                                   | [define](https://esbuild.github.io/api/#define)                                                 |
| Standalone SWC | `jsc: { transform: { optimizer: { globals: { vars: { __DEV__: JSON.stringify(!production) } } } } }` | [optimizer.globals](https://swc.rs/docs/configuration/compilation#jsctransformoptimizerglobals) |
| Jest           | `globals: { __DEV__: true }`                                                                         | [globals](https://jestjs.io/docs/configuration#globals-object)                                  |
| Rstest         | `source: { define: { __DEV__: true } }`                                                              | [source.define](https://rstest.rs/config/build/source#sourcedefine)                             |
| Vitest         | `define: { __DEV__: true }` (top level, outside `test`)                                              | [Configuration](https://vitest.dev/config/)                                                     |

Build-time replacements cover dependencies processed by your build. For
dependencies loaded directly at runtime, provide `__DEV__` through your runtime
or test setup instead.

## License

MIT. See [LICENSE](LICENSE).
