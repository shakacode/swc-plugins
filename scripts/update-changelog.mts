import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gt, lt } from 'semver';
import { changelogRelease, parseReleaseVersion, pluginPackage } from './release.mts';

export function stampChangelog(changelog: string, version: string, date: string) {
  parseReleaseVersion(version);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Use a YYYY-MM-DD date');
  }
  const sections = [...changelog.matchAll(/^## (.+)\r?$/gm)];
  const unreleased = sections[0];
  if (!unreleased || !['Unreleased', '[Unreleased]'].includes(unreleased[1]!)) {
    throw new Error('Changelog must start with an Unreleased section');
  }
  for (const section of sections.slice(1)) {
    const heading = section[1]!.match(/^(?:\[([^\]]+)\]|(\S+))/);
    const previous = parseReleaseVersion(heading?.[1] ?? heading?.[2]);
    if (previous.version === version) {
      throw new Error(`Changelog already contains version ${version}`);
    }
    if (!gt(version, previous)) {
      throw new Error(
        `Version ${version} must be newer than changelog version ${previous.version}`,
      );
    }
  }
  const newline = changelog.includes('\r\n') ? '\r\n' : '\n';
  const start = unreleased.index! + unreleased[0].replace(/\r$/, '').length;
  const notes = changelog.slice(start, sections[1]?.index).trim();
  const history = sections[1] ? `${newline}${changelog.slice(sections[1].index)}` : '';
  const updated = `${changelog.slice(0, start)}${newline}${newline}## ${version} - ${date}${newline}${newline}${notes}${newline}${history}`;
  // Share release validation so the updater cannot produce an unreleasable section.
  changelogRelease(updated);
  return updated;
}

export function updatePackageChangelog(
  root: string,
  directory: string,
  version: string,
  date: string,
  dryRun = false,
) {
  const { packageDirectory, manifest } = pluginPackage(root, directory);
  const file = path.join(packageDirectory, 'CHANGELOG.md');
  const source = readFileSync(file, 'utf8');
  const current = parseReleaseVersion(manifest.version);
  const target = parseReleaseVersion(version);
  const firstRelease = [...source.matchAll(/^## (.+)\r?$/gm)].length === 1;
  if (lt(target, current) || (!firstRelease && !gt(target, current))) {
    throw new Error(
      `Version ${version} must be newer than current package version ${current.version}`,
    );
  }
  const updated = stampChangelog(source, version, date);
  if (!dryRun) {
    writeFileSync(file, updated);
  }
  return updated;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { positionals, values } = parseArgs({
      allowPositionals: true,
      options: {
        date: { type: 'string' },
        'dry-run': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
    const usage =
      'Usage: script/update-changelog <plugin-directory> <version> [--date YYYY-MM-DD] [--dry-run]';
    if (values.help) {
      console.log(usage);
    } else {
      const [directory, version] = positionals;
      if (!directory || !version || positionals.length !== 2) {
        throw new Error(usage);
      }
      const today = new Date();
      const date =
        values.date ??
        [
          today.getFullYear(),
          String(today.getMonth() + 1).padStart(2, '0'),
          String(today.getDate()).padStart(2, '0'),
        ].join('-');
      const updated = updatePackageChangelog(
        fileURLToPath(new URL('..', import.meta.url)),
        directory,
        version,
        date,
        values['dry-run'],
      );
      if (values['dry-run']) {
        process.stdout.write(updated);
      } else {
        console.log(`Updated packages/${directory}/CHANGELOG.md for ${version} (${date}).`);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
