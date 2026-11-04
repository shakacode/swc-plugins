# swc-plugin-remove-prop-types

Remove development-only React `propTypes` definitions from production builds.
The package contains a Rust SWC plugin compiled to WebAssembly.

```sh
pnpm add -D swc-plugin-remove-prop-types
```

Enable it only for production builds:

```ts
const plugins = production ? [[require.resolve('swc-plugin-remove-prop-types'), {}]] : [];

// SWC or Rspack's builtin:swc-loader options:
const options = { jsc: { experimental: { plugins } } };
```

The same Wasm artifact is tested with standalone `@swc/core` and Rspack
`>=2.2.0 <3.0.0`, including the earliest and latest supported Rspack releases.
SWC plugin compatibility depends on the host's SWC version.

## Behavior

```js
import PT from 'prop-types';
function Component() {}
Component.propTypes = { title: PT.string.isRequired };
```

becomes:

```js
function Component() {}
```

The plugin removes standalone `Component.propTypes = ...` assignments,
static class fields named `propTypes`, and global `Object.defineProperty`
calls defining that property. String-literal computed property names also work.
Removed statements do not evaluate their targets, descriptors, or validators.
An assignment used as a value keeps its right-hand value and evaluates it once;
a `defineProperty` call used as a value keeps its target. Empty statements retain
unbraced loop, conditional, and label structure.

Unused bindings from exact `prop-types` imports and unshadowed `require` calls
are pruned automatically, including dead alias chains. Explicit side-effect
imports, live runtime bindings, and type-only imports remain. Matching uses
resolved bindings, so a shadowing variable does not inherit an import's behavior.

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
  validator reads with `null`, factory calls with `void 0`, and factory references
  with functions returning `null`. Validator-construction arguments are dropped.
  This deliberately disables standalone validation; unknown members such as
  `checkPropTypes` remain. Detected mutations and redeclarations prevent
  substitution or pruning through the affected binding, its direct aliases,
  and other imports of the same exact library source.
- `additionalLibraries` adds exact module names to `prop-types`. It does not
  match prefixes, subpaths, or regular expressions. Aggressive substitution
  recognizes the standard validator names on these libraries.

Unknown or malformed options report an error. There is no `removeImport`
option; runtime usage determines which bindings remain. Configure file exclusions
with your bundler's `include`/`exclude` rules.

## Runtime metadata

Some code uses validator dictionaries to enumerate or forward properties.
The plugin preserves a module when it detects a runtime `propTypes` member read
or a named `propTypes` export, including CommonJS exports and exports aliases.
This protection also applies with `removeValidators: true` and does not depend on
package names. Other definitions in the protected module remain as well.
Modules that explicitly modify global `Object` or `require` are also retained.

This is a per-module transform. It cannot detect a consumer in another module
reading an exported component's `propTypes`, dynamically computed property names,
or arbitrary reflection and indirect runtime data flow. These syntactic checks
are not whole-program heap analysis. Exclude modules that rely on such behavior
from the transform. It does not
provide Babel's `wrap` or `unsafe-wrap` modes or assume arbitrary locally defined
helpers implement `Object.defineProperty` or module interop.

## Development

See the repository's [contributor guide](../../CONTRIBUTING.md) for building,
testing, and independent package releases. Options are generated from Rust;
run `pnpm types:generate` after changing their Rust definition.
