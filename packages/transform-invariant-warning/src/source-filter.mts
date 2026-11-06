import {
  createSourceFilter as createFilter,
  normalizeSourceOptions,
  type SourceFilter as SharedSourceFilter,
} from '@shakacode/swc-plugin-utils';
import type { PluginOptions } from '../index.js';
import defaults from './default-options.json' with { type: 'json' };

export type { FileFilterContext } from '@shakacode/swc-plugin-utils';
export type SourceFilter = SharedSourceFilter<Required<PluginOptions>>;

/** Conservatively identify possible configured sources before invoking the guest. */
export function createSourceFilter(options: PluginOptions = {}): SourceFilter {
  const normalized = normalizeSourceOptions(options, defaults);
  return createFilter(normalized, [...normalized.warningSources, ...normalized.invariantSources]);
}
