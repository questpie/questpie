# Documentation Authoring

These rules apply to public documentation under `content/docs/`.

## Reader contract

- Write for a developer learning or operating QUESTPIE, never for an agent inspecting the repository.
- Explain what to use, how it works, and the contract readers can rely on.
- Do not inventory missing helpers, rejected guesses, internal investigation paths, or symbols readers should not search for.
- State API shapes positively. Prefer “Global queries expose `get` and `update`” over “Globals have no `find`”.
- Keep real security, compatibility, and production constraints. Pair each constraint with its effect and the supported path.

## Information architecture

Use this order for every capability:

1. A tutorial or quick start shows a working outcome.
2. A concept page explains the lifecycle, data flow, guarantees, and public API.
3. An adapter page documents backend selection, configuration, capabilities, and operations.
4. Reference pages enumerate exact types and signatures when needed.

Every adapter page must link to the concept it implements. If a capability has no concept page, create that page before expanding its adapter reference.

## Prose

- Lead with the supported path.
- Keep paragraphs focused and short.
- Use examples to teach behavior; use tables for exact contracts.
- Keep internal implementation details only when they define an observable guarantee or an extension contract.
- Avoid commentary about how documentation or code was researched.
