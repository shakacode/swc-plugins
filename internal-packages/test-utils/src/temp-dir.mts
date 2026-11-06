import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

export function createTemporaryDirectory(prefix: string) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  return { directory, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

export function temporaryDirectory(t: TestContext, prefix: string): string {
  const { directory, cleanup } = createTemporaryDirectory(prefix);
  t.after(cleanup);
  return directory;
}
