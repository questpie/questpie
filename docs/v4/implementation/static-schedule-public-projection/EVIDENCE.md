# Static schedule public projection verification

Date: 2026-09-08. Scope: the separate ADR-0043 authority projection, public
schedule guide, supporting guides, portable skill and exact reference-example
compilation. This is ordinary Product documentation review under ADR-0027,
not another formal Kernel review or aggregate beta.2 acceptance.

## Review and adjudication

The committed static-schedule `REVIEW.json` verifies against its exact reviewed
candidate through `bun run review:accept:verify`. Its original formal PASS is
unchanged. Three independent, one-turn documentation consultations then reviewed
the projection on 2026-09-08. All began at 14:40:15 UTC, after the owner's
16:40 Bratislava restriction. Prose completed at 14:41:39 UTC, examples at
14:42:45 UTC, and fact coverage at 14:43:23 UTC. Each exited zero without a
timeout and returned findings, not a manufactured PASS.

Each consultation used Claude Code 2.1.263 and this command with a separate
packet on stdin and the repository's bounded process owner:

```sh
claude --print --model claude-opus-5 --effort medium \
  --no-session-persistence --permission-mode dontAsk --tools "" \
  --safe-mode --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  --disable-slash-commands --no-chrome --output-format json
```

The timeout was 3,600,000 ms. No fallback or repeat review ran. Returned CLI
usage metadata names `claude-opus-5` and auxiliary `claude-haiku-4-5-20251001`
usage; the evidence does not relabel that provenance.

The packets bound 33 source files and the complete dirty projection diff.
Input and output passed the repository secret scanner. Supplemental full-page
context explicitly omitted only the unchanged database-setup line 18 in
`runtime-and-studio.mdx`, while retaining its original source hash. That line
contained a credential-bearing URL outside the changed diff; no changed source
byte or formal acceptance rule was removed or weakened. Packet bindings and raw
results remain in the owned local review directory
`/home/drepkovsky/code/questpie-schedule-doc-review.a9Vmfn`.

The three reviewer-labelled blockers were checked independently against source
and repaired:

| Finding                                                                      | Source adjudication                                                                                                                                                                                                                  | Documentation correction                                                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| App surface omits the durable member used by the guide                       | `packages/compiler/src/generate.ts` declares `GeneratedApp.durable`; `reaction/declarations.ts` declares the worker handle's `poll`; the Support Desk host creates one handle and polls it                                           | Add `durable` to the App surface and distinguish worker creation from polling                            |
| The sweep's nested `get` lock guarantee has no supporting public explanation | `packages/compiler/src/mutation/postgres.ts` emits `FOR UPDATE` before a fresh Policy read; `packages/runtime/src/mutation/collection-get.ts` executes that order; lowering/runtime tests and the PostgreSQL lock-wait test cover it | Explain nested-Mutation get locking in `queries-and-mutations.mdx`; retain the correct sweep guarantee   |
| Revision zero could be confused with the first accepted revision             | `packages/runtime/src/durable/schedule/index.ts` increments the expected revision; runtime and packed CLI tests assert expected `0` produces accepted `1` and exact-request replay                                                   | Name the first request's expected revision and receipt's accepted revision separately, preserving replay |

The earlier inherited cancellation link was also corrected to the existing
`#understand-time-retry-and-cancellation` heading. Nonblocking wording and
example suggestions were advisory; none changes the accepted schedule contract.

## Deterministic verification

The projection passed:

- `bun run review:accept:verify -- --record docs/v4/prototypes/static-job-schedules/REVIEW.json`;
- `bun test tests/integration/static-schedule-docs-draft.test.ts`: one test,
  seven assertions, proving exact public/example-source fence parity and
  compiling the schedule against the reference application;
- `bun run skill:check`;
- `bun run types:check` and `bun run build` in `apps/docs`;
- changed-path `bun run format:check`, changed TypeScript lint with
  `--deny-warnings`, all 37 local page/heading links across five changed public
  pages, v4 navigation targets, and
  `git diff --check`.

After the three corrections, the coordinating agent repeated the verifier,
example compiler, skill check, complete docs typecheck/build and focused unit
coverage with:

```sh
TMPDIR=/home/drepkovsky/code/questpie-react-infinite-tmp.KuKz4Y bun test \
  tests/unit/beta2-public-docs-staging.test.ts \
  tests/unit/public-skill.test.ts \
  tests/unit/beta06-postgres-operation-lowering.test.ts \
  tests/unit/beta06-runtime-collection-operations.test.ts
```

The suite passed 35 tests and 183 assertions. The same command without the
disk-backed `TMPDIR` first produced 33 passes and two public-skill `EDQUOT`
failures on shared `/tmp`. That observed infrastructure failure remains
recorded; no code, test or budget bypass was used. The local review and check
agents did not run a new
PostgreSQL or full release lane for this documentation-only closure.

Projection status is verified. The final integrated PostgreSQL/browser,
load/soak, package and release gates, fresh schedule-inclusive aggregate
manifest, and ADR-0039 acceptance remain separate. This record authorizes no
push, tag, publication or deployment.
