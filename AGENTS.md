# QUESTPIE v4 agent entry

Use the repo-owned `.agents/skills/questpie-v4/SKILL.md` for every product,
proof, implementation, public-documentation, repository-quality, CI, or release
task. Start with `HANDOFF.md`; the skill routes the rest of the authority.

Universal rules:

- Public documentation and Accepted ADRs define v4 behavior. V3 is behavioral
  evidence, not implementation architecture.
- Use Bun and repository package scripts.
- Preserve unrelated work and inspect dirty/worktree state before editing.
- Verify the smallest relevant scope and always run `git diff --check`.
