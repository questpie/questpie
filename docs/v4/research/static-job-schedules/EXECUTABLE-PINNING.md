# Durable executable pinning: source-audit blocker

The current Job claim path compares a contract digest where Accepted ADR-0016,
ADR-0017, ADR-0026, and implementation Gate 7 require compatible executable
bytes. This must be resolved before checkpoint resume can claim safety.

This is a source audit, not yet a two-build PostgreSQL reproduction. No
production implementation or new compatibility contract is established here.

## Observed bindings

| Owner                                                  | Source finding                                                                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Compiler `runtime/index.ts`, `projectRuntimeContract`  | A slot's runtime graph includes the entire origin module's content digest and the normalized Resource contract digest.                    |
| Compiler `job/index.ts`, `projectJobContracts`         | A Job's `contractDigest` hashes only its normalized contract.                                                                             |
| Runtime `durable/acceptance.ts`, `createJobAcceptance` | Acceptance stores `executableDigest: job.contractDigest`; it separately stores the supplied `runtimeBuildDigest`.                         |
| Runtime `durable/postgres-database-kernel.ts`          | Admission derives its available executable list from `definition.contractDigest`.                                                         |
| Runtime `durable/postgres-database-claim.ts`           | Claim compares semantic version and `job.contractDigest` with the stored executable digest; it does not compare the stored Runtime Build. |
| Runtime `durable/worker.ts`, `availableDefinition`     | Handler selection likewise matches the current Job by contract digest.                                                                    |

The paths above are under `packages/compiler/src` and `packages/runtime/src`.
Both independent review and the main agent checked these source statements.

A supplementary Bun probe invoked the production `projectRuntimeContract` with
one synthetic normalized Job and two source-graph entries representing
`handler = () => 1` versus `handler = () => 2`. It reported
`jobContractEqual: true` and `executableGraphEqual: false`. This executes the
projector finding only; it does not compile either handler or exercise a worker.

A code-only handler change can preserve its input/output/run-as/retry contract
while changing executable behavior. Conversely, editing the schedule inside
the origin module changes that module's source digest. Splitting `schedule`
out of the normalized contract alone therefore cannot prove safe reuse of an
old accepted run: it would retain the old contract match without proving that
the executing closure is unchanged.

The generated application imports whole authored Definitions and binds their
handlers (`runtime/application.ts`, `runtime/application-bundle.ts`). A handler
can close over module state. Blindly excluding a `schedule` property from source
hashing is unsafe when that closure reads schedule-derived state.

## Smallest repair to falsify first

The run already stores a Runtime Build digest, and the generated application
verifies its compiled inventory. First test conservative equality with that
verified build at admission and claim, while preserving existing semantic
version and contract checks. Filter before the admission batch limit so an
incompatible backlog cannot starve compatible work. Recheck on claim; an
admission-time observation alone is insufficient.

This candidate uses ADR-0017's existing retained-build operation: an instance
claims only bytes it carries, and pending runs can block old-build retirement.
It does not assume a new historical-handler loader or claim schedule-only edits
preserve executable identity. Its cost is coarse compatibility: even an
unrelated build change can require keeping the prior compatible worker. Delayed
Jobs may extend that retention substantially. The tracer and public deployment
guidance must make this cost visible rather than call refused work recovered.

If the existing verified build binding cannot safely serve as this pin, stop and
name the concrete missing guarantee before designing another artifact loader.
A per-handler digest-addressed loader is a possible later refinement, not
authority inferred from this source audit.

## Required regression slice

1. Compile two builds with identical Job name, semantic version, codecs,
   run-as, and retry, but observably different handler code.
2. Accept direct and Mutation-owned delayed work using build A, then make it
   due. Build B must not admit/claim/execute it or consume an attempt.
3. The retained verified build A must still execute and recover its run.
   New B work must execute on B even with a larger incompatible A backlog.
4. Exercise same-Job contract changes, missing/tampered build artifacts,
   cancellation, restart, and old/new contenders on PostgreSQL 17.
5. Check the shared Reaction path explicitly. A Job-only patch must not leave
   an equivalent latest-code selection hole in the same durable owner.
6. Repeat the generated Team Support Desk/Collaboration worker and browser
   tracers; preserve one kernel and no fallback to current handler bytes.

The activation model proof is separate. Synthetic tick receipts can falsify
activation races but cannot close this compiler/worker binding defect.
