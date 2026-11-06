import vm from 'node:vm';
import { transformSync } from '@swc/core';

export interface CommonJSContext {
  exports?: Record<string, unknown>;
  require?: (name: string) => unknown;
  globals?: Record<string, unknown>;
}

export function executeCommonJS<Exports = Record<string, unknown>>(
  code: string,
  context: CommonJSContext = {},
): Exports {
  const module = { exports: context.exports ?? {} };
  vm.runInNewContext(code, {
    ...context.globals,
    module,
    exports: module.exports,
    require: context.require,
  });
  return module.exports as Exports;
}

export function createPluginTestHarness<PluginOptions extends object>(
  plugin: string,
  filename: string,
) {
  function compile(source: string, options: PluginOptions = {} as PluginOptions): string {
    return transformSync(source, {
      filename,
      jsc: {
        parser: { syntax: 'typescript', tsx: filename.endsWith('.tsx') },
        target: 'es2022',
        experimental: { plugins: [[plugin, options]] },
      },
      module: { type: 'commonjs' },
    }).code;
  }
  function evaluate<Exports = Record<string, unknown>>(
    source: string,
    options: PluginOptions,
    context: CommonJSContext = {},
  ): Exports {
    // Return plain values so VM-realm prototypes do not affect deep comparisons.
    return JSON.parse(JSON.stringify(executeCommonJS(compile(source, options), context)));
  }
  return { compile, evaluate };
}
