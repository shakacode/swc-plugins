import { readFileSync } from 'node:fs';

export interface FileFilterContext {
  /** True when the compiler is watching; watch builds always retain the guest. */
  readonly watch: boolean;
  /** The host has established that raw source eligibility is safe for this input. */
  readonly allowSkipping: boolean;
  /** Supply the host's reader when it does not use the ordinary filesystem. */
  readonly readSource?: (filename: string) => string;
}

export interface SourceFilter<Options> {
  /** Pass these normalized options to the Wasm plugin as well. */
  readonly options: Readonly<Options>;
  test(source: string): boolean;
  testFile(filename: string, context: FileFilterContext): boolean;
}

/** Validate source lists as they survive the host's JSON serialization. */
export function normalizeSourceOptions<Key extends string>(
  options: unknown,
  defaults: Record<Key, readonly string[]>,
): Record<Key, readonly string[]> {
  const parsed: unknown = JSON.parse(JSON.stringify(options));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Plugin options must be an object');
  }
  for (const key of Object.keys(parsed)) {
    if (!Object.hasOwn(defaults, key)) {
      throw new TypeError(`Unknown plugin option: ${key}`);
    }
  }
  const record = parsed as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => {
      const value = Object.hasOwn(record, key) ? record[key] : fallback;
      if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
        throw new TypeError(`${key} must be an array of strings`);
      }
      return [key, value as readonly string[]];
    }),
  ) as Record<Key, readonly string[]>;
}

/** Build a conservative filter from normalized options and all relevant names. */
export function createSourceFilter<Options>(
  options: Options,
  names: readonly string[],
): SourceFilter<Options> {
  const uniqueNames = [...new Set(names)];
  const hasMultilineSource = uniqueNames.some((name) => name.includes('\n'));
  function test(source: string): boolean {
    // Escapes can spell a configured name; static templates normalize CR/CRLF to LF.
    return (
      source.includes('\\') ||
      (hasMultilineSource && source.includes('\r')) ||
      uniqueNames.some((name) => source.includes(name))
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
  return { options, test, testFile };
}
