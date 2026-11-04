# Contributing

Use the Rust toolchain in `rust-toolchain.toml`, Node.js from `.node-version`,
and pnpm from `package.json`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

`pnpm build` compiles the Wasm plugin and copies it into its npm package.
Build before running JavaScript tests.

The integration suite uses the same
artifact with standalone SWC and the earliest and latest supported Rspack releases
(`>=2.2.0 <3.0.0`). CI refreshes `rspack-latest` within that range on every run,
including a weekly scheduled run. Run `pnpm update rspack-latest` to refresh it
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
  documentation; for example, `transform-invariant-warning: preserve shadowed bindings`.
- `tooling:` — shared build scripts, CI, linting, formatting, and workflow configuration.
- `docs:` — repository-wide documentation and contributor guidance.
- `deps:` — shared dependency updates; plugin-specific dependencies use the plugin’s scope.
- `release:` — versioning, packaging, and publishing changes.
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

Plugin option declarations are generated from Rust with `ts-rs`. After changing
the options struct, run `pnpm types:generate` and commit the generated declaration.
Rust tests and CI verify that the declaration is up to date; edit the Rust source
instead of editing the generated file directly.

## Automatic Claude reviews

The [Claude Code Review workflow](.github/workflows/claude-code-review.yml) runs
on non-draft PRs from branches in this repository, excluding Dependabot runs.
It cancels older runs when a PR is updated and verifies that Claude published a
report for the reviewed head and workflow run. The job is not a required merge check.

Maintainers must give the [Claude GitHub app](https://github.com/apps/claude)
access to this repository and provide the `CLAUDE_CODE_OAUTH_TOKEN` Actions
secret, either directly or through an organization secret shared with this repo.
See the [Claude action setup guide](https://github.com/anthropics/claude-code-action/blob/main/docs/setup.md).
Fork PRs are skipped because their workflows cannot access the credential.

## Splitting changes into PRs

Split substantial changes into logical, independently reviewable PRs. Use
[stacked PRs](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/creating-stacked-pull-requests)
when a part depends on an earlier part, with each PR targeting the branch below
it. Open independent parts as separate PRs targeting the intended base branch.
Choose boundaries that make each PR coherent, understandable, and verifiable.

Keep each layer's description focused on its own changes and explain its
relationship to the rest of the stack. Run the applicable checks for each layer
and update dependent branches when an earlier layer changes.
