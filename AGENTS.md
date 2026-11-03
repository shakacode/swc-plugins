# Development instructions

Read and follow [CONTRIBUTING.md](CONTRIBUTING.md) for development setup,
validation, compatibility testing, PR titles, and changelog updates.

For Shaka tasks, read [.agents/shaka.md](.agents/shaka.md) for repository policy
and the setup, test, and validation wrappers.

For release preparation or an audit of missing changelog entries, use the repository's
[update-changelog skill](.agents/skills/update-changelog/SKILL.md).

- Implement plugins in Rust under `crates/`; npm packages live under `packages/`.
- Keep specs and local planning artifacts ignored by Git.
- Use neutral, standalone examples in code, documentation, and Git messages.
- Keep source matching exact and resolve identifiers by binding identity.
- Preserve retained source spans and control flow when rewriting statements.
- Never publish packages or push changes without the user's instruction.
