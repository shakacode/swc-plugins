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
Oxlint and Clippy check JavaScript and Rust respectively.

Each package's changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Record user-visible changes under `Unreleased` in the affected package's
`CHANGELOG.md`. Use Added, Changed, Deprecated, Removed, Fixed, or Security
subsections only when needed. Describe user impact and omit internal-only changes.
At release time, move entries to a versioned section dated `YYYY-MM-DD` and keep
an empty `Unreleased` section at the top.

Commit messages follow [Scoped Commits](https://scopedcommits.com/), with the
first line formatted as `<scope>: <description>`. For a change limited to one
plugin, use its directory name as the scope, for example
`transform-invariant-warning: preserve shadowed bindings`. Use `all` for changes
across plugins or the repository, or `rust` and `js` for shared language-specific
tooling. Write changelog entries for users separately from commit messages.
