import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = mkdtempSync(path.join(tmpdir(), 'swc-package-check-'));
function run(args: string[], cwd = root) {
  execFileSync('pnpm', args, { cwd, stdio: 'inherit' });
}

try {
  for (const entry of readdirSync(path.join(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const directory = path.join(root, 'packages', entry.name);
    const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')) as {
      name: string;
      version: string;
      exports: Record<string, unknown>;
    };
    run(['pack', '--pack-destination', temporary], directory);
    const archive = path.join(
      temporary,
      `${manifest.name.replace(/^@/, '').replaceAll('/', '-')}-${manifest.version}.tgz`,
    );
    run(['exec', 'publint', archive, '--strict']);
    // Plugin roots resolve to Wasm; analyze their JavaScript subpaths with ATTW.
    const entrypoints = Object.keys(manifest.exports).filter((name) => name !== '.');
    if (entrypoints.length > 0) {
      run([
        'exec',
        'attw',
        archive,
        '--entrypoints',
        ...entrypoints,
        '--profile',
        'node16',
        // ATTW models Node 16. Supported modern Node can require ESM; the packed
        // runtime smoke test checks that interop instead.
        '--ignore-rules',
        'cjs-resolves-to-esm',
      ]);
    }
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
