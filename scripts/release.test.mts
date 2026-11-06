import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { changelogRelease, main, prepareRelease, publishRelease, releasePlan } from './release.mts';
import { stampChangelog, updatePackageChangelog } from './update-changelog.mts';
import { verifyReleaseTag } from './verify-release-tag.mts';
import { temporaryDirectory } from '@shakacode/swc-plugin-test-utils/temp-dir';

const changelog = (version = '0.2.0', notes = '### Added\n\n- A useful change.') =>
  `# Changelog\n\n## Unreleased\n\n## ${version} - 2026-11-03\n\n${notes}\n\n## 0.1.0 - 2026-10-01\n\n- Older change.\n`;

test('stamps the initial release while retaining an empty Unreleased section', () => {
  const source = '# Changelog\n\n## Unreleased\n\n### Added\n\n- First feature.\n';
  const updated = stampChangelog(source, '0.1.0', '2026-11-03');
  assert.equal(
    updated,
    '# Changelog\n\n## Unreleased\n\n## 0.1.0 - 2026-11-03\n\n### Added\n\n- First feature.\n',
  );
  assert.equal(changelogRelease(updated).version, '0.1.0');
});

for (const newline of ['\n', '\r\n']) {
  test(`preserves release history and ${JSON.stringify(newline)} line endings`, () => {
    const source = changelog()
      .replace('## Unreleased', '## [Unreleased]\n\n### Fixed\n\n- New fix.')
      .replaceAll('\n', newline);
    const updated = stampChangelog(source, '0.3.0-rc.1', '2026-11-04');
    assert.ok(
      updated.startsWith(
        `# Changelog${newline}${newline}## [Unreleased]${newline}${newline}## 0.3.0-rc.1 - 2026-11-04`,
      ),
    );
    assert.ok(updated.endsWith(source.slice(source.indexOf('## 0.2.0'))));
    assert.equal(changelogRelease(updated).notes, `### Fixed${newline}${newline}- New fix.`);
    assert.throws(() => stampChangelog(updated, '0.3.0-rc.1', '2026-11-04'), /already contains/);
  });
}

test('invalid changelog updates leave files unchanged; dry runs affect no package', (t) => {
  const { root } = fixture(t);
  const alpha = path.join(root, 'packages/alpha/CHANGELOG.md');
  const beta = path.join(root, 'packages/beta/CHANGELOG.md');
  const source = changelog().replace('## Unreleased', '## Unreleased\n\n- New fix.');
  writeFileSync(alpha, source);
  const originalBeta = readFileSync(beta, 'utf8');
  for (const [version, date] of [
    ['0.2.0', '2026-11-04'],
    ['0.3.0', '2026-02-30'],
    ['0.3.0', 'today'],
    ['0.3.0-rc.01', '2026-11-04'],
  ]) {
    assert.throws(() => updatePackageChangelog(root, 'alpha', version!, date!));
    assert.equal(readFileSync(alpha, 'utf8'), source);
  }
  assert.throws(() => stampChangelog(changelog(), '0.3.0', '2026-11-04'), /release notes/);
  assert.throws(() => stampChangelog('# Changelog\n', '0.3.0', '2026-11-04'), /Unreleased/);
  const preview = updatePackageChangelog(root, 'alpha', '0.3.0', '2026-11-04', true);
  assert.equal(readFileSync(alpha, 'utf8'), source);
  updatePackageChangelog(root, 'alpha', '0.3.0', '2026-11-04');
  assert.equal(readFileSync(alpha, 'utf8'), preview);
  assert.equal(readFileSync(beta, 'utf8'), originalBeta);
});

for (const [current, target, accepted] of [
  ['1.2.3', '1.2.2', false],
  ['1.2.3', '1.2.3', false],
  ['1.2.3', '1.2.3-rc.1', false],
  ['1.2.3', '1.2.4', true],
  ['1.2.3', '1.3.0', true],
  ['1.2.3', '2.0.0', true],
  ['1.2.3', '1.7.9', true],
  ['1.2.3', '1.3.0-rc.1', true],
  ['1.3.0-rc.9', '1.3.0-rc.10', true],
  ['1.3.0-rc.10', '1.3.0-rc.9', false],
  ['1.3.0-beta.1', '1.3.0-rc.0', true],
  ['1.3.0-rc.1', '1.3.0-beta.2', false],
  ['1.3.0-rc.1', '1.3.0', true],
] as const) {
  test(`${accepted ? 'accepts' : 'rejects'} version transition ${current} → ${target}`, (t) => {
    const { root } = fixture(t);
    const packageFile = path.join(root, 'packages/alpha/package.json');
    const manifest = JSON.parse(readFileSync(packageFile, 'utf8'));
    writeFileSync(packageFile, JSON.stringify({ ...manifest, version: current }));
    const file = path.join(root, 'packages/alpha/CHANGELOG.md');
    const source = changelog(current).replace('## Unreleased', '## Unreleased\n\n- New fix.');
    writeFileSync(file, source);
    if (accepted) {
      updatePackageChangelog(root, 'alpha', target, '2026-11-04');
      assert.equal(changelogRelease(readFileSync(file, 'utf8')).version, target);
    } else {
      assert.throws(
        () => updatePackageChangelog(root, 'alpha', target, '2026-11-04'),
        /newer|already contains/,
      );
      assert.equal(readFileSync(file, 'utf8'), source);
    }
  });
}

test('the initial version may be stamped once, but never downgraded', (t) => {
  const { root } = fixture(t);
  const file = path.join(root, 'packages/alpha/CHANGELOG.md');
  const source = '# Changelog\n\n## Unreleased\n\n- First feature.\n';
  writeFileSync(file, source);
  assert.throws(
    () => updatePackageChangelog(root, 'alpha', '0.0.9', '2026-11-04'),
    /current package version/,
  );
  assert.equal(readFileSync(file, 'utf8'), source);
  updatePackageChangelog(root, 'alpha', '0.1.0', '2026-11-04');
  assert.equal(changelogRelease(readFileSync(file, 'utf8')).version, '0.1.0');
  assert.throws(
    () => updatePackageChangelog(root, 'alpha', '0.1.0', '2026-11-04'),
    /current package version/,
  );
});

test('checks both package metadata and every prior changelog version', (t) => {
  const { root } = fixture(t);
  const packageFile = path.join(root, 'packages/alpha/package.json');
  const manifest = JSON.parse(readFileSync(packageFile, 'utf8'));
  writeFileSync(packageFile, JSON.stringify({ ...manifest, version: '0.4.0' }));
  const file = path.join(root, 'packages/alpha/CHANGELOG.md');
  const source = changelog().replace('## Unreleased', '## Unreleased\n\n- New fix.');
  writeFileSync(file, source);
  assert.throws(
    () => updatePackageChangelog(root, 'alpha', '0.3.0', '2026-11-04'),
    /current package version/,
  );
  assert.equal(readFileSync(file, 'utf8'), source);
  assert.throws(
    () => stampChangelog(source.replace('## 0.1.0 -', '## 0.5.0 -'), '0.3.0', '2026-11-04'),
    /changelog version 0.5.0/,
  );
});

function fixture(t: TestContext) {
  const directory = temporaryDirectory(t, 'swc-release-test-');
  const root = path.join(directory, 'checkout');
  mkdirSync(root);
  writeFileSync(
    path.join(root, 'Cargo.toml'),
    '[workspace]\nmembers = ["crates/*"]\nresolver = "2"\n',
  );
  for (const [plugin, version] of [
    ['alpha', '0.1.0'],
    ['beta', '7.0.0'],
  ]) {
    const packageDirectory = path.join(root, 'packages', plugin!);
    const crateDirectory = path.join(root, 'crates', plugin!);
    mkdirSync(packageDirectory, { recursive: true });
    mkdirSync(path.join(crateDirectory, 'src'), { recursive: true });
    writeFileSync(
      path.join(packageDirectory, 'package.json'),
      `${JSON.stringify({ name: `swc-plugin-${plugin}`, version })}\n`,
    );
    writeFileSync(path.join(packageDirectory, 'CHANGELOG.md'), changelog());
    writeFileSync(
      path.join(crateDirectory, 'Cargo.toml'),
      `[package]\nname = "swc-plugin-${plugin}"\nversion = "${version}"\nedition = "2024"\n`,
    );
    writeFileSync(path.join(crateDirectory, 'src/lib.rs'), '');
  }
  function git(...args: string[]) {
    return execFileSync(
      'git',
      ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args],
      { cwd: root, encoding: 'utf8' },
    ).trim();
  }
  function commit() {
    git('add', '.');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-qm',
      'release: prepare alpha',
    );
  }
  return { root, git, commit, remote: path.join(directory, 'remote.git') };
}

test('uses only the newest dated release notes and selects npm dist-tags', () => {
  assert.deepEqual(changelogRelease(changelog()), {
    version: '0.2.0',
    notes: '### Added\n\n- A useful change.',
    distTag: 'latest',
  });
  assert.equal(changelogRelease(changelog('1.0.0-rc.1')).distTag, 'next');
  assert.equal(
    changelogRelease(changelog().replace('## 0.2.0 -', '## [0.2.0] -')).version,
    '0.2.0',
  );
});

for (const [label, content] of [
  ['missing release', '# Changelog\n\n## Unreleased\n'],
  ['undated release', changelog().replace(' - 2026-11-03', '')],
  ['invalid date', changelog().replace('2026-11-03', '2026-02-30')],
  ['leading zero', changelog('01.2.0')],
  ['invalid prerelease', changelog('1.0.0-rc.01')],
  ['incomplete version', changelog('1.0')],
  ['version prefix', changelog('v1.0.0')],
  ['build metadata', changelog('1.0.0+build.1')],
  ['missing release notes', changelog('0.2.0', '### Added')],
  [
    'unreleased entries',
    changelog().replace('## Unreleased', '## Unreleased\n\n- Pending change.'),
  ],
]) {
  test(`rejects ${label}`, () => assert.throws(() => changelogRelease(content!)));
}

for (const args of [
  [],
  ['alpha', 'beta'],
  ['alpha', '--unknown'],
  ['alpha', '--prepare', '--dry-run'],
  ['--publish', 'swc-plugin-alpha@0.2.0', '--prepare'],
  ['--publish', 'swc-plugin-alpha@0.2.0', '--dry-run'],
  ['--publish'],
  ['--publish='],
  ['--publish', 'swc-plugin-alpha@0.2.0', 'alpha'],
  ['alpha', '--prepare=true'],
]) {
  test(`rejects invalid release arguments before reading the repository: ${JSON.stringify(args)}`, () => {
    assert.throws(
      () => main('/unused', args),
      /Usage:|Unknown option|argument missing|does not take an argument|mutually exclusive/,
    );
  });
}

test('release help accepts both aliases without reading the repository', (t) => {
  const log = t.mock.method(console, 'log', () => {});
  main('/unused', ['--help']);
  main('/unused', ['-h']);
  assert.equal(log.mock.callCount(), 2);
  assert.match(log.mock.calls[0]!.arguments[0] as string, /^Usage: script\/release/);
});

test('preparing a release updates only the selected package and crate, including Cargo.lock', (t) => {
  const { root } = fixture(t);
  const betaPackage = readFileSync(path.join(root, 'packages/beta/package.json'), 'utf8');
  const betaCrate = readFileSync(path.join(root, 'crates/beta/Cargo.toml'), 'utf8');
  main(root, ['--prepare', 'alpha']);
  const plan = releasePlan(root, 'alpha');
  assert.equal(plan.manifest.version, '0.2.0');
  assert.equal(plan.cargoVersion, '0.2.0');
  assert.match(
    readFileSync(path.join(root, 'Cargo.lock'), 'utf8'),
    /name = "swc-plugin-alpha"\nversion = "0.2.0"/,
  );
  assert.equal(readFileSync(path.join(root, 'packages/beta/package.json'), 'utf8'), betaPackage);
  assert.equal(readFileSync(path.join(root, 'crates/beta/Cargo.toml'), 'utf8'), betaCrate);
  assert.throws(() => releasePlan(root, '../alpha'), /directory/);
});

test('prepares and dry-runs scoped utility releases without a Rust crate', (t) => {
  const { root } = fixture(t);
  const directory = path.join(root, 'packages/swc-plugin-utils');
  mkdirSync(directory);
  writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({ name: '@shakacode/swc-plugin-utils', version: '0.1.0' }),
  );
  writeFileSync(path.join(directory, 'CHANGELOG.md'), changelog());
  const before = readFileSync(path.join(root, 'crates/alpha/Cargo.toml'), 'utf8');
  prepareRelease(root, 'swc-plugin-utils');
  const plan = releasePlan(root, 'swc-plugin-utils');
  assert.equal(plan.manifest.version, '0.2.0');
  assert.equal(plan.cargo, null);
  assert.equal(plan.tag, '@shakacode/swc-plugin-utils@0.2.0');
  assert.equal(readFileSync(path.join(root, 'crates/alpha/Cargo.toml'), 'utf8'), before);
  main(root, ['swc-plugin-utils', '--dry-run']);
});

test('dry runs do not change files or create tags; live release pushes only a package tag', (t) => {
  const { root, git, commit, remote } = fixture(t);
  assert.throws(() => main(root, ['alpha', '--dry-run']), /--prepare/);
  prepareRelease(root, 'alpha');
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  commit();
  git('init', '--bare', '-q', remote);
  git('remote', 'add', 'origin', remote);
  git('push', '-u', 'origin', 'main');
  const head = git('rev-parse', 'HEAD');
  main(root, ['alpha', '--dry-run']);
  main(root, ['--dry-run', 'alpha']);
  assert.equal(git('status', '--porcelain'), '');
  assert.equal(git('tag', '--list'), '');
  git('switch', '-c', 'release/alpha');
  assert.throws(() => main(root, ['alpha']), /clean main/);
  git('switch', 'main');
  writeFileSync(path.join(root, 'uncommitted.txt'), 'pending');
  assert.throws(() => main(root, ['alpha']), /clean main/);
  rmSync(path.join(root, 'uncommitted.txt'));
  main(root, ['alpha']);
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('rev-parse', 'swc-plugin-alpha@0.2.0^{commit}'), head);
  assert.match(git('ls-remote', '--tags', 'origin'), /refs\/tags\/swc-plugin-alpha@0\.2\.0/);
  assert.throws(() => main(root, ['alpha']), /already exists/);
  // Simulate a local tag retained after an unsuccessful push, then retry it.
  git('push', 'origin', ':refs/tags/swc-plugin-alpha@0.2.0');
  main(root, ['alpha']);
  assert.match(git('ls-remote', '--tags', 'origin'), /refs\/tags\/swc-plugin-alpha@0\.2\.0/);
  assert.throws(() => publishRelease(root, 'swc-plugin-alpha@9.0.0'), /must agree/);
  assert.throws(() => publishRelease(root, 'swc-plugin-missing@0.2.0'), /workspace package/);
  // Publishing stops before any registry call if the build artifact is missing.
  assert.throws(() => publishRelease(root, 'swc-plugin-alpha@0.2.0'), /ENOENT/);
});

test('release-tag verification accepts merged commits and rejects unmerged or changed tags', (t) => {
  const { root, git, commit } = fixture(t);
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  commit();
  const head = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', head);
  git('tag', '-a', 'swc-plugin-alpha@0.2.0', '-m', 'release alpha');
  assert.deepEqual(verifyReleaseTag(root, 'swc-plugin-alpha@0.2.0', head), {
    tag: 'swc-plugin-alpha@0.2.0',
    commit: head,
    package: 'swc-plugin-alpha',
  });
  git('tag', '@shakacode/swc-plugin-utils@0.2.0');
  assert.deepEqual(verifyReleaseTag(root, '@shakacode/swc-plugin-utils@0.2.0', head), {
    tag: '@shakacode/swc-plugin-utils@0.2.0',
    commit: head,
    package: '@shakacode/swc-plugin-utils',
  });
  assert.throws(() => verifyReleaseTag(root, '@other/package@0.2.0', head), /release tag/);
  assert.throws(
    () => verifyReleaseTag(root, 'swc-plugin-alpha@0.2.0', '0'.repeat(40)),
    /triggering commit/,
  );
  assert.throws(() => verifyReleaseTag(root, 'swc-plugin-alpha@0.2.0', '--all'), /full commit SHA/);
  assert.throws(() => verifyReleaseTag(root, 'main', head), /release tag/);
  assert.throws(
    () => verifyReleaseTag(root, 'swc-plugin-alpha@0.2.0\npackage=other', head),
    /release tag/,
  );
  git('tag', 'swc-plugin-alpha@0.2.1');
  assert.equal(verifyReleaseTag(root, 'swc-plugin-alpha@0.2.1', head).commit, head);
  git('switch', '-c', 'unmerged');
  writeFileSync(path.join(root, 'pending.txt'), 'unmerged source');
  commit();
  const unmerged = git('rev-parse', 'HEAD');
  git('tag', 'swc-plugin-alpha@0.3.0');
  assert.throws(() => verifyReleaseTag(root, 'swc-plugin-alpha@0.3.0', unmerged));
  git('tag', '-f', 'swc-plugin-alpha@0.2.0');
  assert.throws(() => verifyReleaseTag(root, 'swc-plugin-alpha@0.2.0', head), /triggering commit/);
});

const publicationCases: {
  label: string;
  version: string;
  distTags?: string;
  registryError?: string;
  error?: RegExp;
}[] = [
  { label: 'new stable release', version: '0.2.0', distTags: '{"latest":"0.1.0"}' },
  { label: 'new prerelease', version: '0.2.0-rc.1', distTags: '{"next":"0.2.0-rc.0"}' },
  { label: 'first publication', version: '0.2.0', registryError: 'E404' },
  { label: 'missing stable channel', version: '0.2.0', distTags: '{"next":"0.3.0-rc.1"}' },
  {
    label: 'older stable retry',
    version: '0.2.0',
    distTags: '{"latest":"0.3.0"}',
    error: /newer than.*latest/,
  },
  {
    label: 'already current stable release',
    version: '0.2.0',
    distTags: '{"latest":"0.2.0"}',
    error: /newer than.*latest/,
  },
  {
    label: 'older prerelease retry',
    version: '0.2.0-rc.1',
    distTags: '{"next":"0.3.0-rc.1"}',
    error: /newer than.*next/,
  },
  {
    label: 'registry outage',
    version: '0.2.0',
    registryError: 'E503',
    error: /Cannot read.*registry/,
  },
  {
    label: 'malformed registry response',
    version: '0.2.0',
    distTags: 'not json',
    error: /Cannot read.*registry/,
  },
  {
    label: 'invalid channel version',
    version: '0.2.0',
    distTags: '{"latest":42}',
    error: /registry.*channel/,
  },
  {
    label: 'invalid registry response shape',
    version: '0.2.0',
    distTags: '[]',
    error: /registry.*response/,
  },
];

for (const scenario of [
  ...publicationCases,
  { label: 'scoped utility without Wasm', version: '0.2.0', distTags: '{}' },
]) {
  const { version } = scenario;
  test(`publishing handles ${scenario.label}`, (t) => {
    const { root, git, commit, remote } = fixture(t);
    const utility = scenario.label === 'scoped utility without Wasm';
    const directory = utility ? 'swc-plugin-utils' : 'alpha';
    const packageName = utility ? '@shakacode/swc-plugin-utils' : 'swc-plugin-alpha';
    const packageDirectory = path.join(root, 'packages', directory);
    if (utility) {
      mkdirSync(path.join(packageDirectory, 'dist'), { recursive: true });
      writeFileSync(
        path.join(packageDirectory, 'package.json'),
        JSON.stringify({ name: packageName, version: '0.1.0', type: 'module', files: ['dist'] }),
      );
      writeFileSync(path.join(packageDirectory, 'dist/index.mjs'), 'export const value = 42;');
      writeFileSync(
        path.join(packageDirectory, 'dist/index.d.mts'),
        'export declare const value = 42;',
      );
    }
    writeFileSync(path.join(packageDirectory, 'CHANGELOG.md'), changelog(version));
    prepareRelease(root, directory);
    git('init', '-q', '-b', 'main');
    commit();
    git('init', '--bare', '-q', remote);
    git('remote', 'add', 'origin', remote);
    git('push', '-u', 'origin', 'main');
    git('tag', `${packageName}@${version}`);
    if (!utility) {
      writeFileSync(
        path.join(packageDirectory, 'plugin.wasm'),
        Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
      );
    }
    const bin = path.join(root, 'fake-bin');
    const log = path.join(root, 'publish.jsonl');
    mkdirSync(bin);
    // Intercept only external publication; pnpm still produces a real tarball.
    const stub = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const tool = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const result = { tool, args };
if (tool === 'npm' && args[0] === 'view') {
  appendFileSync(process.env.RELEASE_TEST_LOG, JSON.stringify(result) + '\\n');
  if (process.env.RELEASE_TEST_REGISTRY_ERROR) {
    console.log(JSON.stringify({ error: { code: process.env.RELEASE_TEST_REGISTRY_ERROR } }));
    process.exit(1);
  }
  console.log(process.env.RELEASE_TEST_DIST_TAGS ?? '{}');
  process.exit(0);
}
if (tool === 'npm') {
  result.manifest = JSON.parse(execFileSync('tar', ['-xOf', args[1], 'package/package.json'], { encoding: 'utf8' }));
  result.files = execFileSync('tar', ['-tzf', args[1]], { encoding: 'utf8' });
} else {
  result.notes = readFileSync(args[args.indexOf('--notes-file') + 1], 'utf8');
}
appendFileSync(process.env.RELEASE_TEST_LOG, JSON.stringify(result) + '\\n');
`;
    for (const executable of ['npm', 'gh']) {
      const file = path.join(bin, executable);
      writeFileSync(file, stub);
      chmodSync(file, 0o755);
    }
    const execution = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "const { main } = await import(process.argv[2]); main(process.argv[3], ['--publish', process.argv[4]]);",
        'release-test',
        fileURLToPath(new URL('./release.mts', import.meta.url)),
        root,
        `${packageName}@${version}`,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          RELEASE_TEST_LOG: log,
          RELEASE_TEST_DIST_TAGS: scenario.distTags,
          RELEASE_TEST_REGISTRY_ERROR: scenario.registryError,
        },
      },
    );
    const calls = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(execution.status, scenario.error ? 1 : 0, execution.stderr);
    assert.equal(calls[0].tool, 'npm');
    assert.deepEqual(calls[0].args, ['view', packageName, 'dist-tags', '--json']);
    if (scenario.error) {
      assert.match(execution.stderr, scenario.error);
      assert.equal(calls.length, 1, 'registry failures must stop before publication');
      return;
    }
    assert.equal(calls.length, 3);
    const [, npm, gh] = calls;
    assert.equal(npm.tool, 'npm');
    assert.equal(npm.manifest.name, packageName);
    assert.equal(npm.manifest.version, version);
    if (utility) {
      assert.match(npm.files, /package\/dist\/index.mjs/);
      assert.match(npm.files, /package\/dist\/index.d.mts/);
      assert.doesNotMatch(npm.files, /plugin.wasm/);
    } else {
      assert.match(npm.files, /package\/plugin.wasm/);
    }
    assert.doesNotMatch(npm.files, /beta/);
    assert.deepEqual(npm.args.slice(2), [
      '--access',
      'public',
      ...(version.includes('-') ? ['--tag', 'next'] : []),
    ]);
    assert.equal(gh.tool, 'gh');
    assert.equal(gh.args[2], `${packageName}@${version}`);
    assert.equal(gh.args.includes('--prerelease'), version.includes('-'));
    assert.equal(gh.notes, '### Added\n\n- A useful change.\n');
  });
}
