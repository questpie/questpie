# Human-authorized Codex acceptance substitution

- Candidate: `88899d8393bfc237f40afd7401d4face55196c81`
- Diff base: `1c420531bf5d4e4a97d57e4dff0afa2a8c94fba4`
- Date: 2026-08-28
- Verdict: **PASS**

The repository-pinned Opus v2 reviewer returned terminal `NO_RESULT` with the
category `transport` and wrote no review artifact. The project owner explicitly
authorized one independent Codex reviewer as a substitution so product delivery
would not stop on the unavailable provider.

This file is not an Opus v2 record and must not be passed to
`review:accept:verify`. It records the exceptional human authority and the
honest reviewer identity without modifying or forging the historical v2
protocol.

The fresh read-only reviewer checked the exact committed packet and reported no
blocking finding. In particular, it verified:

- all eight authority-document hashes and the manifest bindings;
- the distinct required boolean and Policy-evidence capability brands;
- Policy-only `expr.exists` and pre-artifact Query rejection through
  `QP-DATA-025`;
- unchanged nondisclosure, normalized Policy projection and SQL-plan digests;
- removal of `policy.exists` from the current public API and active fixtures;
- focused tests with 9 passing tests and 39 assertions;
- a clean worktree and `git diff --check`.

Before the substitution, the candidate also passed `quality:full`,
`quality:release`, independent Standards and Spec reviews, and the PostgreSQL 17
plus Firefox Team Support Desk tracer with 63 assertions.

This outage is the named revisit condition for a future provider-neutral,
machine-verifiable acceptance protocol. That protocol is a separate delivery
slice; this exception does not silently change `questpie.acceptance.v2`.
