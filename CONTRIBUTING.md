# Contributing

Use the Rust toolchain in `rust-toolchain.toml`, Node.js from `.node-version`,
and pnpm from `package.json`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
```

Run `pnpm format` to format supported files with Oxfmt and Rust with rustfmt.
Oxlint checks JavaScript. Rust plugins use Clippy.

Each package's changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Record user-visible changes under `Unreleased` in the affected package's
`CHANGELOG.md`. Use Added, Changed, Deprecated, Removed, Fixed, or Security
subsections only when needed. Describe user impact and omit internal-only changes.
At release time, move entries to a versioned section dated `YYYY-MM-DD` and keep
an empty `Unreleased` section at the top.

Commit messages follow [Scoped Commits](https://scopedcommits.com/), with the
first line formatted as `<scope>: <description>`. For a change limited to one
plugin, use its directory name as the scope. Use `all` for changes
across plugins or the repository, or `rust` and `js` for shared language-specific
tooling. Write changelog entries for users separately from commit messages.
