# Test utilities

Private TypeScript workspace shared by plugin and repository tests. Add
`@shakacode/swc-plugin-test-utils` as a `workspace:*` development dependency to use it.
Node runs the TypeScript sources directly; no build is needed for this workspace.

- `@shakacode/swc-plugin-test-utils/rspack` provides earliest/latest hosts,
  compiler lifecycle helpers, `buildPluginFixture`, `assertSourceMapping`,
  `sourceFilterConfiguration`, `readBuildOutputs`, and `watchCompiler`.
- `@shakacode/swc-plugin-test-utils/plugin` provides `createPluginTestHarness`
  for SWC compilation and JSON-result evaluation, plus `executeCommonJS` for raw exports.
- `@shakacode/swc-plugin-test-utils/package` provides `installPackedPackage`
  for installing real pnpm tarballs into isolated consumers, plus typed `readPackageJson`, `packPackage`,
  `runConsumer`, and `typecheckConsumer` for package checks.
- `@shakacode/swc-plugin-test-utils/temp-dir` provides `temporaryDirectory(t, prefix)`
  with test-managed cleanup, and `createTemporaryDirectory(prefix)` with explicit cleanup
  for scripts.

Keep plugin fixtures and behavior assertions in each plugin's own tests.
Run `pnpm update:rspack` from the repository root to refresh the latest supported
Rspack dependency. The earliest version stays pinned.
