import { readFileSync } from 'node:fs';
import { execCommitlint } from './commitlint.mts';

function lint(args: string[], input?: string) {
  const result = execCommitlint(args, {
    input,
    stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function sha(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error('GitHub event must provide a full commit SHA');
  }
  return value;
}

const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath) {
  throw new Error('GITHUB_EVENT_PATH is required');
}
const event = JSON.parse(readFileSync(eventPath, 'utf8'));
if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
  if (typeof event.pull_request?.title !== 'string') {
    throw new Error('PR title is required');
  }
  // Pass the title as stdin, never as shell code or interpolated workflow YAML.
  lint([], event.pull_request.title);
  lint(['--from', sha(event.pull_request.base?.sha), '--to', sha(event.pull_request.head?.sha)]);
} else if (process.env.GITHUB_EVENT_NAME === 'push') {
  const head = sha(event.after);
  const base = sha(event.before);
  if (/^0+$/.test(base)) {
    lint(['--to', head]);
  } else {
    lint(['--from', base, '--to', head]);
  }
} else {
  throw new Error('Only pull_request and push events are supported');
}
