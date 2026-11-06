import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function packPackage(packageDirectory: string, directory: string) {
  const manifest = JSON.parse(
    readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'),
  ) as { name: string; version: string; main?: string; exports: Record<string, unknown> };
  execFileSync('pnpm', ['pack', '--pack-destination', directory], {
    cwd: packageDirectory,
    stdio: 'pipe',
  });
  const archive = path.join(
    directory,
    `${manifest.name.replace(/^@/, '').replaceAll('/', '-')}-${manifest.version}.tgz`,
  );
  return { manifest, archive };
}

/** Install the real pnpm tarball, including rewritten workspace dependency ranges. */
export function installPackedPackage(directory: string, packageDirectory: string): string[] {
  const { manifest, archive } = packPackage(packageDirectory, directory);
  const installed = path.join(directory, 'node_modules', manifest.name);
  mkdirSync(installed, { recursive: true });
  execFileSync('tar', ['-xf', archive, '--strip-components=1', '-C', installed]);
  return execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((name) => name.replace(/^package\//, ''));
}

export function runConsumer(directory: string, source: string): void {
  const filename = path.join(directory, 'consumer.mjs');
  writeFileSync(filename, source);
  execFileSync(process.execPath, [filename], { cwd: directory, stdio: 'pipe' });
}

export function typecheckConsumer(directory: string, source: string, cwd: string): void {
  const filename = path.join(directory, 'consumer.mts');
  writeFileSync(filename, source);
  execFileSync(
    'pnpm',
    [
      'exec',
      'tsc',
      '--ignoreConfig',
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--module',
      'NodeNext',
      '--target',
      'ES2022',
      filename,
    ],
    { cwd, stdio: 'pipe' },
  );
}
