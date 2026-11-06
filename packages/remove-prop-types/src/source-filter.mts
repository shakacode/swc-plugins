import {
  createSourceFilter as createFilter,
  normalizeSourceOptions,
  type SourceFilter as SharedSourceFilter,
} from '@shakacode/swc-plugin-utils';
import type { PluginOptions } from '../index.js';
import defaults from './default-options.json' with { type: 'json' };

export type { FileFilterContext } from '@shakacode/swc-plugin-utils';
export type SourceFilter = SharedSourceFilter<Required<PluginOptions>>;

/** Conservatively identify possible definitions or validator sources before invoking the guest. */
export function createSourceFilter(options: PluginOptions = {}): SourceFilter {
  const normalized = normalizeSourceOptions(options, defaults);
  // Definitions and unused imports are independent. TypeScript enum lowering
  // can also construct matching property or library names before the guest.
  return createFilter(normalized, [
    'propTypes',
    'prop-types',
    'enum',
    ...normalized.additionalLibraries,
  ]);
}
