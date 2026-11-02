# swc-plugin-transform-invariant-warning

[Changelog](CHANGELOG.md)

A production-only SWC Wasm transform that removes warning calls and strips
invariant diagnostic arguments while retaining invariant failures.

Related prior art: [babel-plugin-dev-expression](https://github.com/4Catalyzer/babel-plugin-dev-expression).
This plugin performs the production rewrites directly. Enable it only for
production builds; development builds should omit it.

## Usage with Rspack

```sh
pnpm add -D swc-plugin-transform-invariant-warning
```

```js
import { createRequire } from 'node:module';
import { rspack } from '@rspack/core';

const require = createRequire(import.meta.url);
const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';

export default {
  mode,
  plugins: [new rspack.DefinePlugin({ __DEV__: JSON.stringify(mode !== 'production') })],
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
              plugins:
                mode === 'production'
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

`__DEV__` is left to Rspack's `DefinePlugin`; this plugin does not rewrite it.
Set it explicitly in other environments, including tests. The same Wasm artifact
targets Rspack 2.2.0 and the latest supported 2.x release through `builtin:swc-loader`.

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
normal tree shaking. Empty statements and blocks preserve unbraced control flow.

Only standalone identifier call statements are rewritten. Calls used as return
values or other expression values, namespace/member calls, zero-argument
invariants, and invariants with a spread as their first argument remain unchanged.
Optional warning calls are removed; optional invariant calls remain unchanged
to preserve their conditional evaluation.

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
CommonJS destructured named bindings are outside the initial scope.

Local functions, parameters, shadowed imports, type-only imports, unrelated
imports, and shadowed `require` functions are preserved. Bindings with detected
reassignments are conservatively left unchanged throughout the file.

## Options

```json
{
  "warningSources": [
    "warning",
    "tiny-warning",
    "fbjs/lib/warning",
    "fbjs/lib/warning.js",
    "hey-listen"
  ],
  "invariantSources": [
    "invariant",
    "tiny-invariant",
    "fbjs/lib/invariant",
    "fbjs/lib/invariant.js",
    "hey-listen"
  ],
  "transformGlobals": true
}
```

- `warningSources` and `invariantSources` **replace** their respective defaults.
  An empty array disables recognition of that kind through imports and requires.
- `transformGlobals` defaults to `true`: unresolved identifiers named `warning`
  and `invariant` are also rewritten. Set it to `false` to require a recognized
  import or require binding.
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
