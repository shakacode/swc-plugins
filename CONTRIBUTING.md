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

Each package's changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Record user-visible changes under `Unreleased` in the affected package's
`CHANGELOG.md`. Use Added, Changed, Deprecated, Removed, Fixed, or Security
subsections only when needed. Describe user impact and omit internal-only changes.
At release time, move entries to a versioned section dated `YYYY-MM-DD` and keep
an empty `Unreleased` section at the top.

Commit messages follow [Scoped Commits](https://scopedcommits.com/), with the
first line formatted as `<scope>: <description>`. Choose a scope based on the
area changed:

- `<plugin-directory>:` — changes limited to one plugin, including its tests and
  documentation; for example, `transform-invariant-warning: preserve shadowed bindings`.
- `tooling:` — shared build scripts, CI, linting, formatting, and workflow configuration.
- `docs:` — repository-wide documentation and contributor guidance.
- `deps:` — shared dependency updates; plugin-specific dependencies use the plugin’s scope.
- `release:` — versioning, packaging, and publishing changes.
- `rust:` — shared Rust code across plugins.
- `js:` — shared JavaScript or TypeScript code across plugins.
- `all:` — changes spanning multiple plugins or areas without a more specific scope.

Commit subjects and pull request titles are checked by commitlint in CI, including
when a PR title is edited. Titles must follow the same format because they become
squash commit subjects. Plugin scopes are discovered from package directories.
Automatically generated merge and revert subjects are also required to follow
this format; use a scoped subject when making those commits.

Run `pnpm exec commitlint --last` to check the latest local commit, or `pnpm exec commitlint --from origin/main --to HEAD` to check a branch.
Local Git hooks are optional and are not installed automatically.

Write changelog entries for users separately from commit messages.

Plugin option declarations are generated from Rust with `ts-rs`. After changing
the options struct, run `pnpm types:generate` and commit the generated declaration.
Rust tests and CI verify that the declaration is up to date; edit the Rust source
instead of editing the generated file directly.
