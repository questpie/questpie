# Manual beta.2 release

The owner chose a manual beta.2 release on 2026-09-09 and deferred CI/CD.
Neither a self-hosted runner nor a GitHub-hosted workflow run is a prerequisite
for this release. This supersedes the runner-only execution requirement in the
earlier beta.2 plan; it does not accept Proposed ADR-0039 or authorize publishing.

## Required evidence

Use the repository scripts against a clean, identified candidate. Retain the
full PostgreSQL 17/browser lane, package and dependency checks,
`quality:release`, forward types, two separately forced byte-identical package
builds/dry-runs, independent reviews and `git diff --check`.

Execute the same five release workloads: `beta08-worker-contention`,
`beta10-ten-instance`, `pb05-mutation-transaction-tail`, `beta10-soak-chaos`
and `beta12-release-gate`. Their workloads and budgets are unchanged. Preserve
failed attempts and cleanup records alongside successful results. Manifest
validation alone is not workload execution.

Manual measurements remain `reference-local`. They satisfy this beta's
owner-selected execution venue, not a stable-runner claim or a cross-machine
performance guarantee. The general stable-runner policy is not being removed;
this is an explicit beta.2 delivery exception. The frozen checks recorded in
[NRQ-06 evidence](../native-react-query/NRQ-06-EVIDENCE.md) supply the current
local results. Rerun affected checks when their inputs change; a failed check
cannot be waived by switching to the manual route.

## Remaining sequence

1. Retain exact candidate, artifact and verification bindings in the fresh
   aggregate acceptance packet. Do not submit its stale pre-extension manifest.
2. Run the permitted manifest-bound ADR-0039 acceptance review. Commit and
   verify a PASS record before a separate authority-projection commit. The
   existing BLOCKED/replacement and terminal NO_RESULT rules are unchanged.
3. Obtain the owner's manual reference-app inspection and explicit release
   authorization before publication. Automated Firefox checks do not assert
   that the owner has inspected the UI.
4. After that authorization, use the repository release tooling from a clean
   release checkout with the verified artifact manifest. Recheck identity and
   artifact equality before publication; do not bypass the package checks with
   ad hoc npm commands. Review any intervening changes and rerun affected gates.

Push, tag, publish, deployment and registry deprecation each remain within the
owner's explicitly authorized scope. This decision performs none of them.
Credentials must stay out of files, commands, logs and review packets.

## Deferred automation

The existing release workflow and its tests remain unchanged. Do not register
a runner, dispatch a workflow, change hosted-runner policy or push a tag to
activate automation for this beta. Resuming CI/CD requires a later owner task;
the [workload workflow design](RELEASE-WORKLOAD-GATE.md) is its starting point.
