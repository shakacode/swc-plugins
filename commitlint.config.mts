import { existsSync, readdirSync } from 'node:fs';

const packages = new URL('./packages/', import.meta.url);
const plugins = readdirSync(packages, { withFileTypes: true })
  .filter(
    (entry) => entry.isDirectory() && existsSync(new URL(`${entry.name}/package.json`, packages)),
  )
  .map((entry) => entry.name);

export default {
  defaultIgnores: false,
  parserPreset: {
    parserOpts: {
      headerPattern: /^([a-z0-9]+(?:-[a-z0-9]+)*): (\S.*)$/,
      headerCorrespondence: ['scope', 'subject'],
    },
  },
  rules: {
    'scope-empty': [2, 'never'],
    'scope-enum': [2, 'always', ['tooling', 'docs', 'deps', 'rust', 'js', 'all', ...plugins]],
    'subject-empty': [2, 'never'],
    'header-trim': [2, 'always'],
  },
  helpUrl: 'https://github.com/shakacode/swc-plugins/blob/main/CONTRIBUTING.md',
};
