# QUESTPIE v4 developer guide staging area

- Audience: framework users and application developers
- Status: design fiction; no acceptance authority
- Product authority: `SPEC.md`, `CONTEXT.md`, and Accepted ADRs
- Promotion target: `apps/docs/content/docs/v4/`

This directory rewrites the architectural product in `SPEC.md` as the guide a
developer should be able to read from start to finish. It is intentionally
written in finished-product voice so the team can judge the learning path,
boilerplate, type inference, runtime behavior and operational story before
implementation.

[`COVERAGE.md`](./COVERAGE.md) maps every `SPEC.md` section to its reader page
and required evidence so architectural promises cannot disappear during the
rewrite.

[`API-INVENTORY.md`](./API-INVENTORY.md) keeps one spelling, owner and type
source for each accepted or candidate developer API while the chapters evolve.

The pages are not public contract yet. A page moves to the public docs only
after its focused contract, executable examples, budgets, integration checks
and fresh Opus-medium acceptance review pass. Open questions and alternatives
stay in `docs/v4/research/`; reader-facing prose stays here.

## Reader journey

| Order | Page                                                                         | Developer outcome                                                        | `SPEC.md` source |
| ----- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------- |
| 1     | [`index.md`](./index.md)                                                     | understand what QUESTPIE owns and follow one request through the system  | 1–3              |
| 2     | [`getting-started.md`](./getting-started.md)                                 | create, compile, migrate and run one application                         | 4–7              |
| 3     | [`model-data.md`](./model-data.md)                                           | define Collections, Relations, Constraints and structural Queries        | 4–6, 8           |
| 4     | [`authorize-with-policy.md`](./authorize-with-policy.md)                     | resolve identity, select Tenant and enforce relational Policy            | 7–8, 11          |
| 5     | [`queries-and-mutations.md`](./queries-and-mutations.md)                     | implement typed reads and transactional writes with one generated `ctx`  | 6–9              |
| 6     | [`realtime.md`](./realtime.md)                                               | watch an observed Query and understand reconciliation guarantees         | 8                |
| 7     | [`durable-work.md`](./durable-work.md)                                       | dispatch Reactions and Jobs atomically and recover from crashes          | 9                |
| 8     | [`routes-actions-and-integrations.md`](./routes-actions-and-integrations.md) | own HTTP, external effects, Auth, Files and Search explicitly            | 7, 11            |
| 9     | [`run-and-deploy.md`](./run-and-deploy.md)                                   | operate the standalone Runtime against portable PostgreSQL               | 2, 4, 12         |
| 10    | [`studio-and-debugging.md`](./studio-and-debugging.md)                       | inspect compilation, Policy, transactions, realtime and durable attempts | 10               |
| 11    | [`limits-and-guarantees.md`](./limits-and-guarantees.md)                     | know exact bounds, errors, compatibility and unsupported behavior        | 8–15             |

## Writing constraints

- Start each page with the developer outcome and complete end-application code.
- Show the authored source, generated server surface, generated client and
  observable Runtime/Studio behavior when they apply.
- Explain where every callback receives its contextual TypeScript type.
- Prefer the v3 job and familiar ergonomics unless a named v4 invariant or
  failure case requires a different mechanism.
- Keep compiler lowering out of the happy path. Put it in one “What QUESTPIE
  generates” section when it helps debugging or implementation.
- Use the collaboration/publishing application as the connected example. It is
  a conformance fixture, not a required project structure or product ontology.
- Do not copy open alternatives into reader prose. Compare them in research,
  choose one candidate for the design-fiction page, and let the page expose its
  DX or semantic problems.
- A code block that depends on inference must later compile verbatim in its
  focused proof. Until then its page remains in this staging directory.

## Promotion checklist

1. The corresponding atlas ticket has one bounded answer.
2. All imports, file paths, callback types, generated members and errors are
   proven by executable fixtures.
3. Canonical artifacts and PostgreSQL/runtime behavior have goldens or
   integration evidence.
4. TypeScript instantiations, editor/check time and generated size fit their
   budgets.
5. A fresh focused Claude Opus review at medium effort returns `PASS`.
6. The ADR index, `CONTEXT.md`, implementation gates and blocked work map agree.
7. Fact, prose and example reviews pass before projection to the public root.
