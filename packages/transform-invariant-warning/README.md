# swc-plugin-transform-invariant-warning

[Changelog](CHANGELOG.md)

An SWC Wasm transform that removes warning calls and strips
invariant diagnostic arguments while retaining invariant failures.

Inspired by this Babel plugin: [babel-plugin-dev-expression](https://github.com/4Catalyzer/babel-plugin-dev-expression).

Enable it only for production builds; omit it in development and tests.

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

See the [transformation tests](https://github.com/shakacode/swc-plugins/blob/main/packages/transform-invariant-warning/tests/plugin.test.mts)
for more examples.

Only standalone identifier call statements are rewritten. Calls used as return
values or other expression values, namespace/member calls, zero-argument
invariants, and invariants with a spread as their first argument remain unchanged.
Optional warning calls are removed; optional invariant calls remain unchanged
to preserve their conditional evaluation.

### Defining `__DEV__`

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
Destructured `require` bindings are not transformed.

Unresolved global calls, local functions, parameters, shadowed imports, type-only
imports, unrelated imports, and shadowed `require` functions are preserved.
Bindings with detected reassignments are conservatively left unchanged throughout the file.

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

## License

MIT. See [LICENSE](LICENSE).
