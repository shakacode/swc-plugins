---
name: update-changelog
description: Audit merged changes for missing SWC plugin changelog entries and prepare a release changelog PR with a proposed version. Use for release preparation or changelog catch-up audits; ordinary PR changelog entries follow CONTRIBUTING.md directly.
---

# Prepare a plugin changelog

Read the repository's `AGENTS.md` and `CONTRIBUTING.md`. The latter owns changelog
formatting, version rules, validation commands, and the release process. Reuse
the existing scripts for mechanical edits.

## Review the release range

Identify the plugin directories under `packages/` covered by the request. If the
request does not identify a plugin and several are plausible, clarify the scope
while gathering the available package versions and changelogs.

Fetch the target branch and tags. Use `origin/main` as the default comparison
target, respecting an explicitly requested branch or revision. Each plugin has
its own npm version, Rust version, changelog, and release tags of the form
`<npm-package-name>@<version>`. A repository-wide latest release or another
plugin's tag is not its release baseline.

Find the selected package's latest published tag reachable from the target,
using SemVer ordering, then inspect the changes since that tag and the associated
merged PRs. For an initial release, inspect the plugin's history from its
introduction. Include shared Rust, JavaScript, or build changes when they affect
the plugin's public behavior; directory-only history can miss those changes.

Compare the implementation and PR evidence with entries already present in the
package's changelog. Add missing user-visible changes under `Unreleased`, improve
inaccurate entries, and consolidate duplicates. Link the relevant PR when
available. Exclude internal-only work according to CONTRIBUTING.md. Do not infer
shipped behavior from a PR title alone or invent evidence when GitHub history is
unavailable; report the coverage gap.

## Prepare the version

A catch-up audit can finish with entries under `Unreleased`; do not stamp a
release unless requested.

For release preparation, use an explicit version supplied by the user. Otherwise,
suggest a version and explain the public changes behind the proposed major,
minor, patch, or prerelease bump. Ask the user to choose before stamping, while
continuing entry review that does not depend on that choice. Check for an initial
release before proposing an increment of an existing placeholder version.

For a stable release following prereleases, review the complete user-facing delta
since the preceding stable release, so the stable notes do not describe only the
last prerelease's incremental changes. Preserve historical release sections.

After the version is selected, follow CONTRIBUTING.md's preparation commands:

```sh
script/update-changelog <plugin-directory> <version> --dry-run
script/update-changelog <plugin-directory> <version>
script/release <plugin-directory> --prepare
```

Use `--date` only when the user specifies a release date. Inspect the resulting
changelog and version changes, ensure unrelated plugins are unchanged, and run
the applicable verification from CONTRIBUTING.md. The script's dry run previews
mechanical edits; it does not validate whether the release notes are complete.

## Deliver the reviewable result

Keep the changelog preparation separate from unrelated working-tree changes.
For a requested PR, work on a branch from the current remote target, using an
isolated worktree when needed. Commit and push only when authorized by the
request; a request to open the changelog PR authorizes its branch push. Follow
CONTRIBUTING.md for PR titles and commit guidance, and include a description
with the selected plugin/version, review range, validation, and any evidence gaps.
For a local-only request, leave a reviewable diff and report its location.

The normal release-preparation diff consists of the selected package's changelog
and npm manifest, its Rust crate manifest, and the corresponding Cargo.lock
update. Explain any additional files required by the actual change.

Publishing is a separate post-merge step. The unflagged
`script/release <plugin-directory>` pushes a tag and triggers npm publication;
do not run it, merge the preparation PR, or invoke publication as part of this
skill unless the user explicitly requested that additional action. Point the
maintainer to CONTRIBUTING.md's post-merge release command in the handoff.
