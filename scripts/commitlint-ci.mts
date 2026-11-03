import { readFileSync } from 'node:fs';
import { execCommitlint } from './lib/commitlint.mts';

if (process.env.GITHUB_EVENT_NAME !== 'pull_request') {
  throw new Error('Only pull_request events are supported');
}
const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath) {
  throw new Error('GITHUB_EVENT_PATH is required');
}
const event = JSON.parse(readFileSync(eventPath, 'utf8'));
if (typeof event.pull_request?.title !== 'string') {
  throw new Error('PR title is required');
}
// Pass the title as stdin, never as shell code or interpolated workflow YAML.
const result = execCommitlint([], {
  input: event.pull_request.title,
  stdio: ['pipe', 'inherit', 'inherit'],
});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
