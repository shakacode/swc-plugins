import { createTemporaryDirectory } from '@shakacode/swc-plugin-test-utils/temp-dir';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { directory: temporary, cleanup } = createTemporaryDirectory('swc-package-check-');
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
      main?: string;
      exports: Record<string, unknown>;
    };
    run(['pack', '--pack-destination', temporary], directory);
    const archive = path.join(
      temporary,
      `${manifest.name.replace(/^@/, '').replaceAll('/', '-')}-${manifest.version}.tgz`,
    );
    run(['exec', 'publint', archive, '--strict']);
    // Analyze JavaScript exports, including the root of utility packages.
    const entrypoints = Object.keys(manifest.exports).filter(
      (name) => name !== '.' || !manifest.main?.endsWith('.wasm'),
    );
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
  cleanup();
}
