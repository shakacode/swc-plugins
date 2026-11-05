# swc-plugin-remove-prop-types

[Changelog](CHANGELOG.md)

Remove React `propTypes` definitions and unused validator dependencies from production builds.

Enable it only for production builds; omit it in development and tests.

## Hosts

Install the plugin:

```sh
pnpm add -D swc-plugin-remove-prop-types
```

### Rspack

This plugin supports Rspack `>=2.2.0 <3.0.0` through `builtin:swc-loader`.

```js
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const production = process.env.NODE_ENV === 'production';

export default {
  mode: production ? 'production' : 'development',
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
              plugins: production ? [[require.resolve('swc-plugin-remove-prop-types'), {}]] : [],
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
      "plugins": [["swc-plugin-remove-prop-types", {}]]
    }
  }
}
```

Use this configuration only for production builds:

```sh
pnpm exec swc src --out-dir dist --config-file .swcrc.production.json
```

## Optional source filter

Use the helper to skip the plugin for files without possible `propTypes`
definitions or configured validator libraries. It accepts the [same options](#options)
as the plugin. Library names matter even with `removeValidators: false`, because
unused imports and requires can be pruned without a definition.

This production Rspack CLI example processes source files directly. Run it with
`rspack build` or `rspack build --watch`; `--watch` keeps the plugin enabled for
all files:

```ts
import { createRequire } from 'node:module';
import type { Configuration, SwcLoaderOptions } from '@rspack/core';
import { createSourceFilter } from 'swc-plugin-remove-prop-types/source-filter';

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
        plugins: [[require.resolve('swc-plugin-remove-prop-types'), filter.options]],
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
`filter.testFile` returns `true` when the plugin may be needed. Read failures
keep the plugin enabled.

Skipping requires `watch: false` and `allowSkipping: true`. When using Rspack's
JavaScript API with `compiler.watch()`, pass `watch: true` to `filter.testFile`.

Set `allowSkipping: false` if earlier loaders or transforms could introduce
`propTypes` definitions or validator imports/requires. This also applies to
inline loaders and other matching rules. Place this plugin first when combining
Wasm plugins.

For virtual files or a custom filesystem, supply
`readSource: (filename: string) => string` in the file context. If your host
already has the actual compiler input, use `filter.test(source)` directly;
`false` means it can skip the plugin.

## Rewrites

```js
import PT from 'prop-types';
export function Component() {
  return 'retained';
}
Component.propTypes = { title: PT.string.isRequired };
```

becomes:

```js
export function Component() {
  return 'retained';
}
```

The plugin also removes static class fields named `propTypes` and unshadowed
global `Object.defineProperty` calls defining that property. Literal computed
names such as `Component['propTypes']` work as well.

Standalone removed definitions do not evaluate their targets, descriptors, or
validators. An assignment used as a value retains and evaluates its right-hand
side once; an `Object.defineProperty` call used as a value retains its target.

Unused bindings from exact `prop-types` imports and unshadowed `require` calls
are pruned, including dead alias chains. This also applies when those bindings
were already unused before the transform.

See the [transformation tests](https://github.com/shakacode/swc-plugins/blob/main/packages/remove-prop-types/tests/plugin.test.mts)
for more examples.

What remains unchanged:

- Explicit side-effect imports, live runtime bindings, and type-only imports.
- Import/require bindings from unrelated validator libraries.
- Dynamic property names and non-static or decorated class fields.
- Modules with detected runtime metadata use, as described below.

## Runtime metadata

Some code enumerates or forwards properties using validator dictionaries. The
plugin preserves the whole module when it detects a runtime `propTypes` member
read or a named `propTypes` export, including CommonJS exports and export aliases.
This protection also applies with `removeValidators: true`. Modules that
explicitly modify global `Object` or `require` are preserved too.

The plugin cannot detect another module reading an exported component's
`propTypes`, arbitrary reflection, or indirect runtime data flow. Exclude modules
that rely on such behavior using your bundler's `include`/`exclude` rules.

The plugin does not provide Babel's `wrap` or `unsafe-wrap` modes or recognize
arbitrary local wrappers around `Object.defineProperty` or module interop.

## Options

```ts
import type { PluginOptions } from 'swc-plugin-remove-prop-types';

const options: PluginOptions = {
  removeValidators: false,
  additionalLibraries: [],
};
```

- `removeValidators` defaults to `false`. Standalone validator expressions and
  calls remain available at runtime. Set it to `true` to replace known imported
  validator reads with `null`, factory calls (including optional calls) with `void 0`, and factory references
  with functions returning `null`. Validator-construction arguments are dropped.
  This disables standalone validation; unknown members such as `checkPropTypes`
  remain unchanged. Detected mutations and redeclarations prevent substitution
  or pruning through the affected binding, its direct aliases, and other imports
  of the same exact library source.
- `additionalLibraries` adds exact module names to `prop-types`. It does not
  match prefixes, subpaths, or regular expressions. Validator substitution
  recognizes the standard validator names on these libraries.

Unknown or malformed options report an error. There is no `removeImport` option;
runtime usage determines which bindings remain.

## License

MIT. See [LICENSE](LICENSE).
