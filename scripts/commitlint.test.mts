import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { execCommitlint } from './lib/commitlint.mts';
import { temporaryDirectory } from '@shakacode/swc-plugin-test-utils/temp-dir';

for (const title of [
  'tooling: check PR titles',
  'docs: explain the workflow',
  'deps: update shared dependencies',
  'rust: share transform helpers',
  'js: share test helpers',
  'all: update multiple plugins',
  'transform-invariant-warning: preserve bindings',
  'transform-invariant-warning: release 0.2.0',
]) {
  test(`accepts ${title}`, () => {
    const result = execCommitlint([], { input: title });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}

for (const title of [
  'fix: correct a bug',
  'release: prepare packages',
  'feat(transform-invariant-warning): add an option',
  'unknown-plugin: add a transform',
  'missing scope',
  'docs:',
  'docs: ',
  'docs:no space',
  'docs:  extra space',
  'Merge pull request #1',
]) {
  test(`rejects ${JSON.stringify(title)}`, () => {
    const result = execCommitlint([], { input: title });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /scope|subject|header/i);
  });
}

test('CI checks only the edited PR title without executing title text', (t) => {
  const directory = temporaryDirectory(t, 'scoped-pr-titles-');
  const eventPath = path.join(directory, 'event.json');
  const marker = path.join(directory, 'must-not-exist');
  function run(title: unknown, eventName = 'pull_request') {
    writeFileSync(
      eventPath,
      JSON.stringify({
        action: 'edited',
        pull_request: { title },
        // Commit messages and SHAs have no role in title validation.
        commits: [{ message: 'WIP' }],
      }),
    );
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./commitlint-ci.mts', import.meta.url))],
      {
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: eventName,
          GITHUB_EVENT_PATH: eventPath,
          GIT_DIR: path.join(directory, 'no-git-repository'),
        },
        encoding: 'utf8',
      },
    );
    assert.ifError(result.error);
    return result;
  }
  const valid = run(`tooling: validate $(touch ${marker})`);
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  assert.equal(existsSync(marker), false);
  assert.equal(run('unscoped title').status, 1);
  assert.notEqual(run(null).status, 0);
  assert.notEqual(run('tooling: validate titles', 'push').status, 0);
});
