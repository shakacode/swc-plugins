import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'semver';

const repository = 'shakacode/swc-plugins';
export function parseReleaseVersion(version: unknown) {
  const parsed = typeof version === 'string' ? parse(version) : null;
  if (!parsed || parsed.version !== version || parsed.build.length) {
    throw new Error(
      'Use an npm SemVer version such as 1.2.3 or 1.3.0-rc.1, without build metadata',
    );
  }
  return parsed;
}

function readJson(file: string) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function pluginPackage(root: string, directory: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(directory)) {
    throw new Error('Select a plugin directory under packages/');
  }
  const packageDirectory = path.join(root, 'packages', directory);
  const manifest = readJson(path.join(packageDirectory, 'package.json'));
  if (
    manifest.private ||
    typeof manifest.name !== 'string' ||
    !/^swc-plugin-[a-z0-9-]+$/.test(manifest.name)
  ) {
    throw new Error('Select a publishable SWC plugin package');
  }
  return { packageDirectory, manifest };
}

function command(root: string, executable: string, args: string[]) {
  return execFileSync(executable, args, { cwd: root, encoding: 'utf8' }).trim();
}

export function changelogRelease(changelog: string) {
  const sections = [...changelog.matchAll(/^## (.+)\r?$/gm)];
  if (sections[0]?.[1] !== 'Unreleased' && sections[0]?.[1] !== '[Unreleased]') {
    throw new Error('Changelog must start with an Unreleased section');
  }
  const heading = sections[1];
  const match = heading?.[1].match(/^(?:\[([^\]]+)\]|(\S+)) - (\d{4}-\d{2}-\d{2})$/);
  const version = match?.[1] ?? match?.[2];
  if (!match || !version) {
    throw new Error('Add a release heading: ## X.Y.Z - YYYY-MM-DD (npm prereleases are supported)');
  }
  const semver = parseReleaseVersion(version);
  if (new Date(match[3]!).toISOString().slice(0, 10) !== match[3]) {
    throw new Error('Release date must be a valid calendar date');
  }
  const notes = changelog.slice(heading!.index! + heading![0].length, sections[2]?.index).trim();
  if (!notes.replace(/^#+.*$/gm, '').trim()) {
    throw new Error('The release section must contain release notes');
  }
  const unreleased = changelog
    .slice(sections[0]!.index! + sections[0]![0].length, heading!.index)
    .trim();
  if (unreleased) {
    throw new Error('Move this package’s Unreleased entries into the dated release section');
  }
  return { version, notes, distTag: semver.prerelease.length ? 'next' : 'latest' };
}

export function releasePlan(root: string, directory: string) {
  const { packageDirectory, manifest } = pluginPackage(root, directory);
  const cargoPath = path.join(root, 'crates', directory, 'Cargo.toml');
  const cargo = readFileSync(cargoPath, 'utf8');
  const packageSection = cargo.match(/^\[package\]\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1];
  const cargoName = packageSection?.match(/^name = "([^"]+)"$/m)?.[1];
  const cargoVersion = packageSection?.match(/^version = "([^"]+)"$/m)?.[1];
  if (cargoName !== manifest.name || !cargoVersion) {
    throw new Error('The matching Rust crate must have the same package name and its own version');
  }
  const release = changelogRelease(
    readFileSync(path.join(packageDirectory, 'CHANGELOG.md'), 'utf8'),
  );
  return {
    ...release,
    name: manifest.name as string,
    tag: `${manifest.name}@${release.version}`,
    directory,
    packageDirectory,
    manifest,
    cargoPath,
    cargo,
    cargoVersion,
  };
}

function requirePrepared(plan: ReturnType<typeof releasePlan>) {
  if (plan.manifest.version !== plan.version || plan.cargoVersion !== plan.version) {
    throw new Error(
      'Package and crate versions must match the changelog; run script/release <plugin> --prepare in your release PR',
    );
  }
}

export function prepareRelease(root: string, directory: string) {
  const plan = releasePlan(root, directory);
  const cargo = plan.cargo.replace(
    /^(\[package\]\r?\n[\s\S]*?^version = ")[^"]+("$)/m,
    (_match, prefix: string, suffix: string) => `${prefix}${plan.version}${suffix}`,
  );
  writeFileSync(
    path.join(plan.packageDirectory, 'package.json'),
    `${JSON.stringify({ ...plan.manifest, version: plan.version }, null, 2)}\n`,
  );
  writeFileSync(plan.cargoPath, cargo);
  // Update workspace package versions without refreshing third-party dependencies.
  command(root, 'cargo', ['update', '--workspace', '--offline']);
  console.log(
    `Prepared ${plan.tag}. Commit the changelog, package.json, Cargo.toml, and Cargo.lock in a release PR.`,
  );
}

export function publishRelease(root: string, tag: string) {
  const directories = readdirSync(path.join(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const directory = directories.find((entry) =>
    tag.startsWith(`${readJson(path.join(root, 'packages', entry, 'package.json')).name}@`),
  );
  if (!directory) {
    throw new Error('Release tag does not identify a workspace package');
  }
  const plan = releasePlan(root, directory);
  requirePrepared(plan);
  if (
    tag !== plan.tag ||
    command(root, 'git', ['rev-parse', `${tag}^{commit}`]) !==
      command(root, 'git', ['rev-parse', 'HEAD'])
  ) {
    throw new Error('Tag, checked-out commit, and changelog version must agree');
  }
  command(root, 'git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main']);
  // A missing Wasm file would otherwise be silently omitted from the npm tarball.
  const wasm = readFileSync(path.join(plan.packageDirectory, 'plugin.wasm'));
  if (!wasm.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) {
    throw new Error('Build the plugin before publishing');
  }
  const temporary = mkdtempSync(path.join(tmpdir(), 'swc-release-'));
  try {
    command(plan.packageDirectory, 'pnpm', ['pack', '--pack-destination', temporary]);
    const tarballs = readdirSync(temporary).filter((file) => file.endsWith('.tgz'));
    if (tarballs.length !== 1) {
      throw new Error('Expected exactly one packed package');
    }
    // npm's current CLI supports OIDC trusted publishing; pnpm 8 does not.
    execFileSync(
      'npm',
      ['publish', path.join(temporary, tarballs[0]!), '--access', 'public', '--tag', plan.distTag],
      { cwd: root, stdio: 'inherit' },
    );
    const notes = path.join(temporary, 'notes.md');
    writeFileSync(notes, `${plan.notes}\n`);
    command(root, 'gh', [
      'release',
      'create',
      plan.tag,
      '--repo',
      repository,
      '--verify-tag',
      '--title',
      plan.tag,
      '--notes-file',
      notes,
      '--latest=false',
      ...(plan.distTag === 'next' ? ['--prerelease'] : []),
    ]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function main(root: string, args: string[]) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      prepare: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      publish: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const usage = 'Usage: script/release <plugin-directory> [--prepare | --dry-run]';
  if (values.help) {
    console.log(
      `${usage}\nPrepare versions in a release PR, then run without flags from synchronized main to publish via GitHub Actions.`,
    );
    return;
  }
  if (
    [values.prepare, values['dry-run'], values.publish !== undefined].filter(Boolean).length > 1
  ) {
    throw new Error('--prepare, --dry-run, and --publish are mutually exclusive');
  }
  if (values.publish !== undefined) {
    if (!values.publish || positionals.length) {
      throw new Error('Usage: node scripts/release.mts --publish <tag>');
    }
    publishRelease(root, values.publish);
    return;
  }
  const [directory] = positionals;
  if (!directory || positionals.length !== 1) {
    throw new Error(usage);
  }
  if (values.prepare) {
    prepareRelease(root, directory);
    return;
  }
  const plan = releasePlan(root, directory);
  requirePrepared(plan);
  console.log(`${plan.tag}\nnpm dist-tag: ${plan.distTag}\n\n${plan.notes}`);
  if (values['dry-run']) {
    return;
  }
  if (
    command(root, 'git', ['branch', '--show-current']) !== 'main' ||
    command(root, 'git', ['status', '--porcelain'])
  ) {
    throw new Error('Release from a clean main checkout after merging the release PR');
  }
  command(root, 'git', ['fetch', 'origin', '--tags']);
  const head = command(root, 'git', ['rev-parse', 'HEAD']);
  if (head !== command(root, 'git', ['rev-parse', 'origin/main'])) {
    throw new Error('Update main to origin/main before releasing');
  }
  const remoteTag = command(root, 'git', [
    'ls-remote',
    '--tags',
    'origin',
    `refs/tags/${plan.tag}`,
  ]);
  if (remoteTag) {
    throw new Error(
      `Tag ${plan.tag} already exists; inspect its publish workflow instead of retagging`,
    );
  }
  if (command(root, 'git', ['tag', '--list', plan.tag])) {
    if (command(root, 'git', ['rev-parse', `${plan.tag}^{commit}`]) !== head) {
      throw new Error(
        `Local tag ${plan.tag} points to another commit; inspect it before releasing`,
      );
    }
  } else {
    command(root, 'git', ['tag', '-a', plan.tag, '-m', plan.tag]);
  }
  execFileSync('git', ['push', 'origin', `refs/tags/${plan.tag}`], { cwd: root, stdio: 'inherit' });
  console.log(`Pushed ${plan.tag}; publish.yml will validate and publish this package.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(fileURLToPath(new URL('..', import.meta.url)), process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
