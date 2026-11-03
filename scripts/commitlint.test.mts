import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

for (const subject of [
  'tooling: check commit subjects',
  'docs: explain the workflow',
  'deps: update shared dependencies',
  'release: prepare packages',
  'rust: share transform helpers',
  'js: share test helpers',
  'all: update multiple plugins',
  'transform-invariant-warning: preserve bindings',
]) {
  test(`accepts ${subject}`, () => {
    const result = spawnSync('pnpm', ['exec', 'commitlint'], { input: subject, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}

for (const subject of [
  'fix: correct a bug',
  'feat(transform-invariant-warning): add an option',
  'unknown-plugin: add a transform',
  'missing scope',
  'docs:',
  'docs: ',
  'docs:no space',
  'docs:  extra space',
  'Merge pull request #1',
]) {
  test(`rejects ${JSON.stringify(subject)}`, () => {
    const result = spawnSync('pnpm', ['exec', 'commitlint'], { input: subject, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /scope|subject|header/i);
  });
}

test('CI checks edited PR titles and the complete commit range without executing title text', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'scoped-commits-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  function git(...args: string[]) {
    return execFileSync(
      'git',
      [
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        ...args,
      ],
      { cwd: directory, encoding: 'utf8' },
    ).trim();
  }
  git('init', '-q');
  git('commit', '--allow-empty', '-qm', 'all: initial setup');
  const base = git('rev-parse', 'HEAD');
  git('commit', '--allow-empty', '-qm', 'tooling: validate subjects');
  const validHead = git('rev-parse', 'HEAD');
  git('commit', '--allow-empty', '-qm', 'unscoped subject');
  const invalidHead = git('rev-parse', 'HEAD');
  const eventPath = path.join(directory, 'event.json');
  const marker = path.join(directory, 'must-not-exist');
  function run(title: string, head: string) {
    writeFileSync(
      eventPath,
      JSON.stringify({
        action: 'edited',
        pull_request: {
          title,
          base: { sha: base },
          head: { sha: head },
        },
      }),
    );
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./commitlint-ci.mts', import.meta.url))],
      {
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_EVENT_PATH: eventPath,
          GIT_DIR: path.join(directory, '.git'),
          GIT_WORK_TREE: directory,
        },
        encoding: 'utf8',
      },
    );
    assert.ifError(result.error);
    return result;
  }
  const valid = run(`tooling: validate $(touch ${marker})`, validHead);
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  assert.equal(existsSync(marker), false);
  assert.equal(run('unscoped title', validHead).status, 1);
  assert.equal(run('tooling: validate subjects', invalidHead).status, 1);
  assert.notEqual(run('tooling: validate subjects', '--help').status, 0);
});
