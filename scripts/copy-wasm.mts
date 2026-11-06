import { readPackageJson } from '@shakacode/swc-plugin-test-utils/package';
import { execFileSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface CargoMetadata {
  workspace_members: string[];
  target_directory: string;
  packages: {
    id: string;
    name: string;
    version: string;
    manifest_path: string;
    targets: { name: string; crate_types: string[] }[];
  }[];
}

const root = fileURLToPath(new URL('..', import.meta.url));
const metadata: CargoMetadata = JSON.parse(
  execFileSync('cargo', ['metadata', '--locked', '--no-deps', '--format-version', '1'], {
    cwd: root,
    encoding: 'utf8',
  }),
);
const workspace = new Set(metadata.workspace_members);
for (const crate of metadata.packages) {
  if (!workspace.has(crate.id)) {
    continue;
  }
  const target = crate.targets.find((entry) => entry.crate_types.includes('cdylib'));
  if (!target) {
    continue;
  }
  const directory = path.basename(path.dirname(crate.manifest_path));
  const packageDirectory = path.join(root, 'packages', directory);
  const manifest = readPackageJson(packageDirectory);
  if (manifest.name !== crate.name || manifest.version !== crate.version) {
    throw new Error(`Package and crate names and versions must match for ${directory}`);
  }
  copyFileSync(
    path.join(metadata.target_directory, 'wasm32-wasip1', 'release', `${target.name}.wasm`),
    path.join(packageDirectory, 'plugin.wasm'),
  );
}
