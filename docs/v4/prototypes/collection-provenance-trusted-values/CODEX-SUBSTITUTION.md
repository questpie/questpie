# Human-authorized Codex acceptance substitution

- Candidate: `395641dd1c93934511fc748a31a8b30c0283a913`
- Diff base: `143e5696ea44dd93baf3241be19eaa45104ad97e`
- Date: 2026-08-28
- Verdict: **PASS**

The project owner explicitly authorized an independent Codex reviewer while the
repository-pinned Opus transport was unavailable. This is an honest exceptional
substitution record, not an Opus v2 artifact, and must not be passed to
`review:accept:verify`.

The first Spec review blocked the candidate because it did not demonstrate a
forged Tenant create value reaching candidate Policy and because its prototype
could discard an intentional null normalizer result. The repaired candidate:

- proves candidate Policy rejects a forged trusted `organizationId` on create;
- preserves intentional nullish normalizer output without falling back to raw
  input;
- proves trusted nullable normalization reaches both candidate Policy and the
  returned candidate.

A fresh clean-room reviewer then checked the complete exact diff and all ten
manifest criteria. All eight authority hashes matched. The executable proof,
repo formatter, linter and `git diff --check` passed. Independent Standards and
Spec re-reviews also passed with no remaining blocker.

This accepts only the narrow Field-provenance and trusted-values Kernel
decision. Production completion still requires the subsequent test-first
compiler, Runtime, PostgreSQL and generated-client implementation evidence.
