# QUESTPIE v4 handoff

Current work is the documentation rewrite and onboarding CLI on `feat/v4` in
`/home/drepkovsky/code/questpie-v4`. Inspect Git/worktree state before editing
and use the repo-owned `.agents/skills/questpie-v4/SKILL.md`.

## Authority

[SPEC](SPEC.md) owns product behavior, [CONTEXT](CONTEXT.md) canonical terms,
and the [ADR index](docs/adr/README.md) accepted decisions. Public docs project
those decisions. [Delivery flow](docs/v4/DELIVERY-FLOW.md) owns the development
process. Read historical research or proof details only when the task needs
them; [the internal document map](docs/v4/README.md) separates those sources.

Beta.1 remains frozen history. The beta.2 implementation is integrated, but
**ADR-0039 is Proposed and beta.2 is not published**. Use the
[scope inventory](docs/v4/beta2-release-scope.md), not older worktree handoffs,
for the release contents.

## Documentation and onboarding work — 2026-09-09

The owner requested researched public documentation and explicitly authorized
implementing missing CLI steps in this repository. No push or publication.
See [the delivery record](docs/v4/implementation/docs-onboarding-cli.md) for
scope, research, review dispositions, and current verification. The public
learning path now uses one cumulative Barbershop ticket example and a separate
API reference. New commands project the existing migration and Seed kernels:
`init`, `migration plan`, `migration create`, and `seed create`.

These working-tree changes are not covered by the earlier beta.2 acceptance
or release evidence. Preserve that evidence and bind a fresh candidate before
resuming release acceptance. Auth remains an application integration; Files,
Search, Studio, and built-in health endpoints are not supplied by this work.

## Integration branch — 2026-09-21

`work/v4-integration-20260921` (worktree `questpie-v4-worktrees/integration`)
merges the docs/onboarding-CLI line above with `work/autopilot-rewrite-additions`:
the public `questpie/testing` DB-backed test harness (**ADR-0045, Proposed**)
and the MCP/canonical-HTTP credential challenge gate — `challenge`,
`protectCatalog`, `requireCredential` on `defineCredentialResolver`
(**ADR-0046, Proposed**). See
[the delivery record](docs/v4/implementation/integration-2026-09-21.md) for
the merge-conflict resolutions, the exact release-artifact manifest entries
that changed and why, and every gate command and result.

Both public packages were rebuilt and packed twice independently after the
merge; the pairs were byte-identical. Only the `questpie` archive sha256 and
two declaration hashes (root `.` and the new `./testing` subpath) changed in
`quality/release/package-artifacts.json`; `questpie-opentelemetry` and the
other three `questpie` declarations are unchanged. `bun run scripts/release.ts
--dry-run` passes end to end. Nothing was pushed, tagged, or published; no
npm registry write ran.

## Manual release continuation (after this work)

The owner chose a [manual beta.2 release](docs/v4/implementation/beta2-closure/MANUAL-RELEASE.md).
CI/CD and runner provisioning are deferred. Existing checks and workload
budgets remain required; measurements retain `reference-local` classification.

1. Bind the current scope and completed evidence into a fresh aggregate
   acceptance manifest. The retained beta.2 manifest still describes the older
   pre-schedule/pre-native-React candidate and must not be submitted unchanged.
2. Use the ticket-specific acceptance profile and wrapper from the proof skill.
   Commit and verify a PASS record before a separate ADR-0039 authority
   projection. Preserve the BLOCKED/replacement and terminal NO_RESULT rules.
3. Obtain the owner's manual reference-app inspection and explicit publication
   authorization. Push, tag, publish, deploy and registry deprecation are not
   authorized by a test result or acceptance PASS.

[NRQ-06 evidence](docs/v4/implementation/native-react-query/NRQ-06-EVIDENCE.md)
binds the latest complete local checks to their exact candidate and artifacts:

- PostgreSQL 17/Firefox: 187 tests, four environment skips, zero failures,
  2,135 assertions; all four affected load/soak scenarios pass.
- `quality:release`: 1,229 ordinary tests, 198 gated skips, zero failures;
  separate native browser/tutorial, OTel and CLI gates pass.
- Forward types, negative controls, two forced builds/dry-runs and direct
  archive byte comparison pass. Measured release budget: 14.58 s / 15 s.
- Verification resources were cleaned. The manual preview remains intentional.

These completed checks are not claims about later edits. Rerun affected gates
when their inputs change; keep historical failures and actual result identities.

## Closed scope and boundaries

The accepted lifecycle, inverse relations, HTTP/OpenAPI, Operation documentation,
MCP, discriminated-value helpers, OpenTelemetry, schedules and native React
integration are implemented. Their contracts remain in SPEC and Accepted ADRs;
release cleanup is not a new design exercise.

- Two public npm packages: `questpie` and `questpie-opentelemetry`.
  Compiler, Runtime and testkit workspaces stay private.
- ADR-0044 owns `questpie/react-query`: native ordinary/Suspense and forward
  infinite Queries, invalidation, scoped retirement and Start SSR/hydration.
  The old `questpie/react` hook/export is deleted; neutral `.observe` remains.
- ADR-0043 owns static UTC Job schedules and minimum named-Mutation checkpoints.
  Protocol v9 has an explicit non-rolling cutover.
- Framework optimism/rebase, TanStack DB, live infinite lists, offline/persistence,
  Action checkpoints, dynamic schedule CRUD and broader workflows are deferred.
- ADR-0041's explain CLI remains Proposed. Autopilot implementation, landing
  pages, Files, Search and Studio are outside this release task.
- Keep the one Policy-aware kernel per operation; obsolete syntax is removed
  without compatibility implementations.

The [native production plan](docs/v4/implementation/native-react-query/PLAN.md)
and its evidence own the completed extraction details. Historical prototype
versions are not supported product versions.

## Reference app and preview

Team Support Desk is the beginner/DX consumer; Collaboration is the hostile
authority/realtime consumer; Archive supplies portability checks. Preferred
Desk layout is domain-local `src/`, product `web/`, Runtime adapters,
immutable migrations/Seeds and separate `tracer/` automation.

The normal Desk and Scalar preview is isolated from verification databases.
Its current ownership/port record is
`/home/drepkovsky/code/questpie-desk-preview-control.DEFL38/control.json`.
App, Scalar and OpenAPI last returned HTTP 200. No interactive browser was
connected, so fresh manual visual inspection is not claimed. The fixture host
is not a production deployment template.

Preserve the native integration worktree and accepted React proof worktree:
`/home/drepkovsky/code/questpie-v4-native-react-integration` and
`/home/drepkovsky/code/questpie-v4-react-query-proof`. They retain checked
artifacts and preview dependencies. Inspect exact ownership before stopping
any host, receiver, container or port; historical addresses do not grant it.

## Working constraints

Use Bun and repository scripts. Serialize fixture compilation and release
generation within each worktree. Use task-owned disk-backed `TMPDIR` for full
checks: shared `/tmp` has produced quota failures. Preserve dirty/unmerged work,
backup refs and stashes; the dirty inverse-budget worktree is not an integration
candidate. Credentials stay out of files, commands, logs and review packets.

Use the existing ordinary-child compiler/browser helpers: Bun test-host
resolution and shared installer-cache defects have reproductions in the native
evidence. They are not reasons to alter production resolution or add fallbacks.
Public examples and skills use only the checked package surface.

Historical step-by-step handoffs remain in Git history. Accepted review records,
proof bindings, immutable migrations and Seeds remain in the repository.
