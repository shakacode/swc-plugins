# Contributing

Use the Rust toolchain in `rust-toolchain.toml`, Node.js from `.node-version`,
and pnpm from `package.json`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm check:packages
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

`pnpm build` compiles the Wasm plugin, copies it into its npm package, and
compiles the TypeScript host helpers and their declarations.
Build before running JavaScript tests.

`pnpm check:packages` packs each npm package once and runs Publint and
Are the Types Wrong? against its published exports and declarations. Wasm roots
are excluded from JavaScript type analysis; packed runtime tests cover Node's
ESM/CommonJS interop.

The integration suite uses the same
artifact with standalone SWC and the earliest and latest supported Rspack releases
(`>=2.2.0 <3.0.0`). CI refreshes `rspack-latest` within that range on every run,
including a weekly scheduled run. Run `pnpm update:rspack` to refresh it
locally; `rspack-earliest` stays pinned to 2.2.0.

Run `pnpm format` to format supported files with Oxfmt and Rust with rustfmt.
Run `pnpm lint` to lint JavaScript and TypeScript with Oxlint and Rust with Clippy.

Each package's changelog follows [Keep a Changelog 2.0.0](https://keepachangelog.com/en/2.0.0/).
Record user-visible changes under `Unreleased` in the affected package's
`CHANGELOG.md`. Use Added, Changed, Deprecated, Removed, Fixed, or Security
subsections only when needed. Describe user impact and omit internal-only changes.
Start each changelog with a short preamble linking to that convention and
Semantic Versioning. Mark breaking entries with `**Breaking:**` under their
normal change type, explaining what breaks and linking to substantial upgrade
instructions. Version comparison links use the affected package's
`<npm-package-name>@<version>` tags, since plugins are versioned independently.
At release time, move entries to a versioned section dated `YYYY-MM-DD` and keep
an empty `Unreleased` section at the top.

Pull request titles follow [Scoped Commits](https://scopedcommits.com/), formatted
as `<scope>: <description>`. Choose a scope based on the area changed:

- `<plugin-directory>:` — changes limited to one plugin, including its tests and
  documentation, and releases; for example,
  `transform-invariant-warning: release 0.2.0`.
- `tooling:` — shared build and release scripts, CI, linting, formatting, and workflow configuration.
- `docs:` — repository-wide documentation and contributor guidance.
- `deps:` — shared dependency updates; plugin-specific dependencies use the plugin’s scope.
- `rust:` — shared Rust code across plugins.
- `js:` — shared JavaScript or TypeScript code across plugins.
- `all:` — changes spanning multiple plugins or areas without a more specific scope.

Pull request titles are checked by commitlint in CI, including when a title is
edited. Plugin scopes are discovered from package directories. Individual commits
within a PR may use any clear message.

The repository allows squash merging only and defaults the squash commit message
to the PR title. Preserve that title when merging so `main` has one scoped commit
per PR.

To check a title locally:

```sh
printf '%s\n' 'tooling: improve CI' | pnpm exec commitlint
```

Every pull request must have a description explaining what changed, why, and how
it was validated; include relevant documentation links.

Write changelog entries for users separately from PR titles.

Plugin option declarations are generated from Rust with `ts-rs`. Default source
lists for host helpers are generated from the same Rust options. After changing
the options struct or defaults, run `pnpm types:generate` and commit the generated files.
Rust tests and CI verify that the declaration is up to date; edit the Rust source
instead of editing the generated file directly.

## Splitting changes into PRs

Split substantial changes into logical, independently reviewable PRs. Use
[stacked PRs](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/creating-stacked-pull-requests)
when a part depends on an earlier part, with each PR targeting the branch below
it. Open independent parts as separate PRs targeting the intended base branch.
Choose boundaries that make each PR coherent, understandable, and verifiable.

Keep each layer's description focused on its own changes and explain its
relationship to the rest of the stack. Run the applicable checks for each layer
and update dependent branches when an earlier layer changes.

## Releasing a plugin

Public packages have independent versions. Each plugin npm package and its matching Rust crate
share a version; other plugins are unaffected. The release flow follows
[ShakaPerf's package-specific tags and publishing workflow](https://github.com/shakacode/shakaperf/blob/main/.github/workflows/publish.yml),
with a changelog-driven `script/release` entry point like
[React on Rails](https://github.com/shakacode/react_on_rails/blob/master/script/release).

Prepare a release on a branch:

For release preparation or a catch-up audit, agents can use the repository's
[update-changelog skill](.agents/skills/update-changelog/SKILL.md) to review
merged changes, fill missing entries, suggest a version, and prepare a release
PR. The scripts below perform the mechanical changes and also work without an
agent. Ordinary PR changelog entries only need the changelog guidance above.
Publishing is a separate post-merge action.

The TypeScript-only `swc-plugin-utils` package uses the same release commands
and scoped `@shakacode/swc-plugin-utils@<version>` tags, without a Rust crate or
Wasm artifact. Publish it before plugin releases that depend on its new version.

Invoke it as `$update-changelog` in Codex or `/update-changelog` in Claude Code.
Other agents can read the linked `SKILL.md` directly. The canonical skill lives
under `.agents/skills/`; `.claude/skills` links to that directory, so all
repository skills have one maintained copy.

1. Run `script/update-changelog transform-invariant-warning 0.1.0`. This moves
   that package's `Unreleased` entries into a dated version section, keeping an
   empty `Unreleased` section above it and preserving older releases. The date
   defaults to today in your local timezone; use `--date YYYY-MM-DD` to override
   it or `--dry-run` to preview without writing. Prereleases use npm SemVer, for
   example `0.2.0-rc.1`. Empty entries, invalid versions, and versions no newer
   than the current package or any changelog release are rejected. The first
   release may use the package's existing initial version. Upward version jumps
   are allowed; the script does not impose a one-step bump policy.
2. Run `script/release transform-invariant-warning --prepare`. This reads the
   version from the changelog and updates that package's `package.json`, its
   crate's `Cargo.toml`, and `Cargo.lock`. It does not commit or publish.
3. Run the standard validation and merge these changes through a release PR.

Then update your clean `main` checkout from `origin/main` and run:

```sh
script/release transform-invariant-warning --dry-run
script/release transform-invariant-warning
```

The dry run prints the version, tag, distribution tag, and release notes without
changing files or contacting the network. The live command checks that `main`
matches `origin/main`, then creates and pushes an annotated tag such as
`swc-plugin-transform-invariant-warning@0.1.0`. It does not push commits to `main`.
Run the command once for each package being released.

The tag push starts the unprivileged `release-tag.yml` workflow, which automatically
triggers `publish.yml` from the default branch. No separate local dispatch command
is needed. The publishing workflow verifies the tag's exact commit and ancestry
on `origin/main` using trusted main code before checking out any tagged source.
It builds and tests that revision, including the same Wasm artifact on the earliest
and latest supported Rspack releases, and checks that package/crate versions and
the changelog agree. It packs and publishes only the selected package, then creates
a GitHub release using that package's changelog notes.

Publishing jobs for the same package are queued and serialized. Immediately before publication,
the script checks that the release is newer than the registry's current channel;
registry failures stop publication, except a package-not-found response for the
first release. Stable versions use npm's default `latest` tag and its older-version
check. Prereleases explicitly use `next` and are marked as prereleases on GitHub.
Package releases do not set a repository-wide GitHub “latest release.”

### Publishing credentials

The GitHub `npm` environment must allow the `main` branch only, using a branch
policy with no tag policies. `publish.yml` runs from `main` even though it checks
out a verified release commit. This restriction needs no manual approval and
prevents a workflow on an unmerged branch or tag from accessing publishing
credentials. It is enforced by GitHub, outside the tagged source.

Configure an [npm trusted publisher](https://docs.npmjs.com/trusted-publishers/)
for each package: organization `shakacode`, repository `swc-plugins`, workflow
`publish.yml`, environment `npm`, with direct `npm publish` allowed. The environment
name is required for this setup: omitting it would allow other refs to request
publishing credentials. GitHub Actions uses OIDC; no
long-lived npm credential is needed once this is configured. The workflow uses
`pnpm pack` and npm's current CLI for publishing because the pinned pnpm 8 does
not support npm's OIDC authentication. Node from `.node-version` includes a
sufficiently recent npm CLI.

For a new npm package, bootstrap its first publish with a maintainer-authorized
publishing credential in the `npm` environment's `NPM_TOKEN` Actions secret.
Do not store that token as a repository-wide secret. Once the
package exists, configure its trusted publisher and remove the bootstrap secret.
Only configure the trusted publisher when ready to publish: npm requires its
first successful publish within two days. Publishing provenance is generated
automatically with OIDC for this public repository.

If a workflow fails before publication, fix the external problem and rerun that
publishing workflow for the existing tag. A retry is rejected if an equal or newer
version already occupies its channel. Do not move an existing release tag. If npm
publication succeeded but GitHub release creation failed, finish the GitHub
release separately with `gh release create`, using the existing tag and notes
from the corresponding package changelog; rerunning npm publication of that
version will fail because npm versions are immutable.
