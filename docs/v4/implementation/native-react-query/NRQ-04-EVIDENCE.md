# Native Support Desk migration

This is NRQ-04 production-consumer evidence under Accepted ADR-0044, not a new
architecture review or aggregate beta.2 acceptance. The starting checkpoint is
`3fd908179`. The public packed tutorials and old-hook deletion remain NRQ-05 work.

## Executed consumer

The existing domain-local Support Desk now uses `questpie/react-query` and
native TanStack Query hooks. `AuthGate` keys `DeskSession` by the Better Auth
session identity and Context. Each effect setup creates a fresh generated scope,
QueryClient and adapter; cleanup retires that adapter and clears its cache.
StrictMode setup/cleanup does not rebind a disposed scope.

Queue, teams, detail and labels have one native result owner each. Create,
assign, comment, edit, close and reopen use generated native Mutation options.
The notification Action retains its existing generated call and explicit effect
key. Search selects a ticket through the existing generated one-shot call.
Neither path adds a cache, retry loop or Operation registry.

`SelectedTicket` is the executed typed pending-intent recipe. Its generated
Mutation options infer variables and `onMutate` context. Pending comment text
is rendered separately from the current successful authorized ticket, never
inserted into its Query cache. No saved snapshot, rollback or no-flicker claim
is introduced.

## Red controls and focused results

- The first native detail control failed because the old component ignored the
  adapter and had no pending-intent rendering. After migration the control sees
  the actual generated transport and native Mutation state.
- Reusing the credential subtree key fails because the old pending form remains
  connected. Restoring the session/Context key removes it, releases old watches
  and prevents a late old create result from touching the replacement form.
- The UI-only operation observer initially had no implementation. A second red
  control showed that failure to clone a response could replace the successful
  application response. The repair rejects only tracer capture and returns the
  original response unchanged.
- The full DOM run exposed a queued TanStack notification after the test removed
  `window`. Cleanup now drains the retired owner's next-task notifications before
  restoring DOM globals. This is test-host cleanup, not a product scheduler change.

The isolated golden DOM entry passes **10 tests / 103 assertions**. It covers
native queue/create, equal-Context credential replacement with pending work,
Field omission and null ticket results, decoded success, declared rejection,
known committed-result failure, unknown outcome and an overlapping successful
edit followed by rejected comment. Two old-hook-only controls remain temporarily
in the same entry until NRQ-05 removes them.

These DOM controls use a controlled generated-protocol peer. They are not
PostgreSQL Policy evidence or visual inspection.

## PostgreSQL 17 and Firefox

Executed from the active production worktree:

```sh
TMPDIR=/home/drepkovsky/code/questpie-react-infinite-tmp.KuKz4Y bun run tests/support/native-react-query-postgres-run.ts desk
```

Result: **1 test / 111 assertions**, zero failures. The existing complete Desk
journey retains direct/generated execution, auth, durable work, webhook,
notification receiver, lifecycle timestamps and customer inverse disclosure.
Firefox now submits comments, closes/reopens tickets, sends the summary Action
and submits invalid create through the real product UI. The tracer observes only
the explicitly armed operation response to obtain receipt identities; it does
not invoke those Mutations or Actions directly or add product UI hooks.

Successful create has native DOM evidence. Successful create/edit/assign have
not gained additional Firefox click coverage in this slice. The unrelated
Start browser suite owns Suspense/infinite/SSR; this plain React Desk does not
claim those rendering modes.

The runner removes inherited database and fixture overrides, rejects an occupied
loopback receiver port without stopping its owner, creates an isolated
PostgreSQL 17 container and removes its own container and temporary directory.
The preserved preview database is not used. No owned native-query container
remained after this run.

## Other checks and review frontier

The runner/observer/journey unit controls pass **8 tests / 26 assertions**.
The structural product-browser build and README link test pass **2 tests /
5 assertions**. Full Desk strict TypeScript, changed-file format/lint, questpie
types and `git diff --check` pass.

Independent review of the root-authored Selected/detail files has no correctness
or Spec blocker. Independent review of the separately authored provider/queue
files has no Standards or Spec findings. The Action-only generic executor was
replaced with a concrete summary handler; the original reviewer confirmed the
simplification. Review never counts an author as independent for their own files.

The complete `quality:release` passes **1,219 ordinary tests**, **197 gated
skips**, zero failures, plus the isolated **10 / 103** DOM suite, nine workspace
typechecks, six builds, architecture, formatting, lint, Knip, docs, skill and
package checks. The packed OTel isolation control passes **1 / 2,393** and the
packed CLI control **1 / 24**. Performance-manifest validation is not an actual
tagged stable-runner workload. Raw gate output is retained in the task-owned
`questpie-native-desk-gate.HUeoqg/quality-release.log` outside the repository.

Three independent ordinary Claude `--model opus --effort high` README reviews
checked facts, prose and examples. These are alias-selected ordinary reviews,
not a pinned formal acceptance verdict. Their verified repairs and adjudication:

- Add the built-package prerequisite, explicit isolated DOM command and
  `FIREFOX_BIN` discovery; distinguish JSDOM/in-process transport from Firefox/PG.
- Correct lifetime/factory labels, mention direct search/Action calls, clarify
  Scalar's invalid Context placeholder and the local fixture's demo signing key.
- Replace stale living handoff text and historical manual-host instructions.
- Remove the unused 43120 preflight: the real app binds an ephemeral port. The
  changed runner test first fails on the extra port, then passes **4 / 14**.
- React cleanup starts terminal retirement synchronously and handles its Promise;
  it does not reuse an owner. A Context prop change without the required React
  key is outside this private component's contract, not a supported replacement
  path. The native tutorial must show host-owned disposal explicitly.
- The inherited sign-out failure UI is an application-hardening follow-up, not
  a newly introduced credential-retirement bug: failed sign-out does not retire
  a still-authenticated subtree. The UI owner should surface that failure.

After the Action/port repairs, the complete owned PostgreSQL/Firefox journey
again passes **1 / 111**, the isolated DOM suite **10 / 103**, and fixture strict
types and affected checks pass. The broad gate above precedes those small review
repairs; it is not falsely labelled a frozen final beta.2 gate.

The golden migration and README/typed consumer recipe are ready for NRQ-05's
package extraction. The public packed how-to is a shared NRQ-04/05 exit: it must
execute the same native interface, not handwritten generated-client stubs. Public
tutorials, obsolete-export deletion, final aggregate gates and the user's visual
preview remain required before release readiness.
