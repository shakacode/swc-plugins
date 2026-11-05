# Test utilities

Private TypeScript workspace shared by plugin and repository tests. Add
`@swc-plugins/test-utils` as a `workspace:*` development dependency to use it.
Node runs the TypeScript sources directly; no build is needed for this workspace.

- `@swc-plugins/test-utils/rspack` provides `rspackHosts` for earliest/latest
  compatibility tests, the configuration type accepted by both hosts,
  `runCompiler` (run, check errors, and close), and `closeCompiler` for watch tests.
- `@swc-plugins/test-utils/temp-dir` provides `temporaryDirectory(t, prefix)`;
  the test context removes the directory after the test finishes.

Keep plugin fixtures and behavior assertions in each plugin's own tests.
Run `pnpm update:rspack` from the repository root to refresh the latest supported
Rspack dependency. The earliest version stays pinned.
