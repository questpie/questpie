---
"questpie": patch
"@questpie/admin": patch
---

Skill docs: `AGENTS.md` is now generated from `SKILL.md` + `references/` (single source of truth, no drift), with a new `scripts/build-skill-docs.ts`. Writing-great-skills pass over both skills — added a dedicated seeds reference plus architecture/app-context/realtime references, reconciled the env docs (t3-env scaffold default vs `questpie/env` opt-in), fixed the tanstack-query operator reference (`eq`, not `equals`), and collapsed cross-file duplication to single-source pointers.
