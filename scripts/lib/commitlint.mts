import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';

export function execCommitlint(
  args: string[] = [],
  options: Omit<SpawnSyncOptionsWithStringEncoding, 'encoding'> = {},
) {
  const result = spawnSync('pnpm', ['exec', 'commitlint', ...args], {
    ...options,
    encoding: 'utf8',
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}
