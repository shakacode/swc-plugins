import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export function verifyReleaseTag(root: string, tag: string, expectedCommit: string) {
  if (!/^swc-plugin-[a-z0-9]+(?:-[a-z0-9]+)*@[^\s/@]+$/.test(tag)) {
    throw new Error('Select a package release tag');
  }
  if (!/^[0-9a-f]{40}$/.test(expectedCommit)) {
    throw new Error('Expected a full commit SHA from the tag workflow');
  }
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('check-ref-format', `refs/tags/${tag}`);
  const commit = git('rev-parse', '--verify', '--end-of-options', `refs/tags/${tag}^{commit}`);
  if (commit !== expectedCommit) {
    throw new Error('Release tag no longer points to the triggering commit');
  }
  git('merge-base', '--is-ancestor', commit, 'origin/main');
  return { tag, commit, package: tag.slice(0, tag.lastIndexOf('@')) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: { tag: { type: 'string' }, commit: { type: 'string' } },
    });
    if (!values.tag || !values.commit) {
      throw new Error('Usage: verify-release-tag.mts --tag <tag> --commit <sha>');
    }
    const result = verifyReleaseTag(
      fileURLToPath(new URL('..', import.meta.url)),
      values.tag,
      values.commit,
    );
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        Object.entries(result)
          .map(([key, value]) => `${key}=${value}\n`)
          .join(''),
      );
    } else {
      console.log(JSON.stringify(result));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
