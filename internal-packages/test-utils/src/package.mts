import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Install the real pnpm tarball, including rewritten workspace dependency ranges. */
export function installPackedPackage(directory: string, packageDirectory: string): string[] {
  const manifest = JSON.parse(readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'));
  execFileSync('pnpm', ['pack', '--pack-destination', directory], {
    cwd: packageDirectory,
    stdio: 'pipe',
  });
  const archive = path.join(
    directory,
    `${manifest.name.replace(/^@/, '').replaceAll('/', '-')}-${manifest.version}.tgz`,
  );
  const installed = path.join(directory, 'node_modules', manifest.name);
  mkdirSync(installed, { recursive: true });
  execFileSync('tar', ['-xf', archive, '--strip-components=1', '-C', installed]);
  return execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((name) => name.replace(/^package\//, ''));
}
