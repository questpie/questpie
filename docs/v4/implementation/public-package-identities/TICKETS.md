# Public package identities tickets

- Status: Proposed; unimplemented
- Delivery rule: pull in order through the packed Team Support Desk tracer
- Compatibility rule: delete old identities; never add aliases or fallbacks

## Blocking graph

```text
PPI-00 authority PASS
  -> PPI-01 red identity/deletion contract
       -> PPI-02 questpie/react consolidation --+
       -> PPI-03 adapter plus CLI rename -------+-> PPI-04 fixture migration
                                                     -> PPI-05 release harness
                                                       -> PPI-06 public docs
                                                         -> PPI-07 tracers/reviews
                                                           -> PPI-08 final gates
```

PPI-04 waits for PPI-02 and PPI-03. PPI-05 waits for PPI-02 through PPI-04.
No implementation ticket is agent-ready before PPI-00.

## PPI-00 — Ratify the package-identity delta

- Blocked by: none
- Owns: focused supersession of ADR-0033/0035 package-name and package-count
  clauses; exact two-package beta.2 inventory; React optional-peer placement;
  declaration-manifest coverage; deletion ledger; post-PASS Accepted authority
  projection before implementation
- Evidence: deterministic candidate checks and the required committed formal
  `PASS` on a clean manifest-bound head
- Does not own: implementation or any authority projection before PASS
- Done when: accepted authority permits exactly `questpie` with
  `questpie/react` plus `questpie-opentelemetry`, with no old-name compatibility

## PPI-01 — Make package identity and deletion tests red

- Blocked by: PPI-00
- Red tests: exact public package set, new import specifiers, old specifier
  non-resolution, core-without-optionals, React absent/mismatch, CLI single-name
  resolution, and complete public declaration digest coverage
- Artifacts: focused unit/integration test changes only
- Done when: tests fail for the expected old implementation reasons and no
  production code has changed

## PPI-02 — Consolidate React into `questpie/react`

- Blocked by: PPI-01
- Owns: `questpie` `./react` ESM/declaration export, optional React peer,
  unchanged one-hook implementation, core root isolation
- Deletes: publishable `@questpie/react` workspace, archive, build path,
  extraction helper, and old import path
- Hostiles: root import without React; subpath with React 19; missing React;
  React 18; unexpected runtime exports; React import leakage into core entry/CLI
- Verification: focused package test, core and package typechecks,
  `package:check`, `architecture:check`

## PPI-03 — Rename the official adapter and CLI resolver

- Blocked by: PPI-01
- Owns: `questpie-opentelemetry` manifest identity, exact core peer, fixture
  installation path, CLI application-root resolution
- Deletes: old scoped dependency/import and every fallback probe
- Hostiles: old name present but new name absent; missing export; hostile thrown
  value; invalid configuration disclosure; peer/metadata mismatch; core SDK
  dependency leakage
- Verification: OTEL package-isolation and packed CLI tests, CLI unit tests,
  package typecheck, `package:check`

## PPI-04 — Migrate the golden consumer

- Blocked by: PPI-02, PPI-03
- Owns: Team Support Desk dependencies and imports for `questpie/react` and
  `questpie-opentelemetry`; packed tracer installation helpers
- Deletes: source-spelling assertions and workspace dependencies for both old
  scoped names
- Hostiles: browser bundle uses generated client plus the new React subpath;
  telemetry host starts and closes the renamed packed adapter; no workspace-only
  resolution hides a missing archive
- Verification: fixture typecheck, React browser test, smallest Team Support
  Desk PostgreSQL 17/Firefox tracer

## PPI-05 — Bind the exact two-package release

- Blocked by: PPI-02, PPI-03, PPI-04
- Owns: release profiles, package contract, packed-consumer helpers, exact
  two-artifact manifest, sorted per-export declaration SHA-256 inventory,
  combined relocated consumer
- Deletes: third-package assumptions, React archive record, scoped install
  directories, and `exact-three-package` assertions
- Hostiles: missing/extra/old-name artifact; archive or declaration tamper;
  two-pack nondeterminism; absent/mismatched peers; core-only clean build;
  combined imports of all three public entry specifiers
- Verification: beta release unit/performance tests, two local dry-runs while
  iterating, `package:check`, strict dependency audit

## PPI-06 — Project current public and release documentation

- Blocked by: PPI-05
- Owns: beta.2 scope, public React/OpenTelemetry guides, semantic-surface page,
  implementation ledgers, install examples, and release-facing package
  inventory
- Preserves: verbatim historical ADR bodies, proof manifests, review records,
  prototypes, and research
- Gate: scan rejects old names in production, fixtures, release tooling and
  current public docs; a closed allowlist contains historical evidence only
- Verification: docs build/typecheck, format/lint, link and old-name scan

## PPI-07 — Close tracers and independent review

- Blocked by: PPI-06
- Owns: packed Team Support Desk PostgreSQL 17/Firefox journey and affected
  Collaboration package-isolation/hostile evidence
- Evidence: no generated digest is refreshed without observed byte change;
  protocol/domain separators remain stable; deliberate failures clean all
  processes and resources
- Reviews: independent Standards review and Spec review against PPI-00 and this
  implementation spec; repair only concrete findings
- Done when: both reviews PASS and every affected tracer is green on one clean
  head

## PPI-08 — Freeze the release candidate

- Blocked by: PPI-07
- Owns: measured final archive/declaration hashes, final beta.2 version and
  manifest consistency, release evidence and cleanup audit
- Verification: `bun run quality:release`; two consecutive
  `bun run release -- --dry-run` executions with byte-identical output;
  `git diff --check`; clean worktree/resource inspection
- Constraint: do not push, tag, publish, or deploy
- Done when: the exact final head satisfies every gate and is ready for the
  separately authorized release action
