import { readFileSync } from 'node:fs';
import type { PluginOptions } from '../index.js';
import defaults from './default-options.json' with { type: 'json' };

export interface FileFilterContext {
  /** True when the compiler is watching; watch builds always retain the guest. */
  readonly watch: boolean;
  /** The host has established that raw source eligibility is safe for this input. */
  readonly allowSkipping: boolean;
  /** Supply the host's reader when it does not use the ordinary filesystem. */
  readonly readSource?: (filename: string) => string;
}

export interface SourceFilter {
  /** Pass these normalized options to the Wasm plugin as well. */
  readonly options: Readonly<Required<PluginOptions>>;
  test(source: string): boolean;
  testFile(filename: string, context: FileFilterContext): boolean;
}

/** Conservatively identify possible definitions or validator sources before invoking the guest. */
export function createSourceFilter(options: PluginOptions = {}): SourceFilter {
  // Match the options that survive the host's JSON serialization, including
  // omitted undefined properties, before accepting a configuration for bypass.
  const parsed: unknown = JSON.parse(JSON.stringify(options));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Plugin options must be an object');
  }
  for (const key of Object.keys(parsed)) {
    if (key !== 'removeValidators' && key !== 'additionalLibraries') {
      throw new TypeError(`Unknown plugin option: ${key}`);
    }
  }
  const record = parsed as Record<string, unknown>;
  const removeValidators = Object.hasOwn(record, 'removeValidators')
    ? record.removeValidators
    : defaults.removeValidators;
  if (typeof removeValidators !== 'boolean') {
    throw new TypeError('removeValidators must be a boolean');
  }
  const additionalLibraries = Object.hasOwn(record, 'additionalLibraries')
    ? record.additionalLibraries
    : defaults.additionalLibraries;
  if (
    !Array.isArray(additionalLibraries) ||
    !additionalLibraries.every((entry): entry is string => typeof entry === 'string')
  ) {
    throw new TypeError('additionalLibraries must be an array of strings');
  }
  const normalized = { removeValidators, additionalLibraries };
  // Definitions can be removed without imports. Unused library bindings can
  // also be pruned without definitions, even when removeValidators is false.
  const names = [...new Set(['propTypes', 'prop-types', ...additionalLibraries])];
  const hasMultilineSource = names.some((name) => name.includes('\n'));
  function test(source: string): boolean {
    // Any escape can spell a configured name. Keep uncertain inputs rather than
    // parsing or fetching their AST; aliases do not affect source eligibility.
    // Cooked static templates also normalize CR and CRLF to LF.
    return (
      source.includes('\\') ||
      // TypeScript enum lowering can construct matched names before the guest.
      source.includes('enum') ||
      (hasMultilineSource && source.includes('\r')) ||
      names.some((name) => source.includes(name))
    );
  }
  function testFile(filename: string, context: FileFilterContext): boolean {
    if (context?.watch !== false || context.allowSkipping !== true) {
      return true;
    }
    try {
      return test(
        context.readSource ? context.readSource(filename) : readFileSync(filename, 'utf8'),
      );
    } catch {
      return true;
    }
  }
  return { options: normalized, test, testFile };
}
