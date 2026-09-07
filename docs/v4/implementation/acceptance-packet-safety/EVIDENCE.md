# Packet-safety implementation evidence

This is repository-quality evidence, not a product acceptance record. The owner
approved the bounded change described in [the decision](./DECISION.md); the
schedule review has not been invoked.

## Test-first results

The first real-repository packet test failed because protocol v2 rejected the
new manifest field. It now reconstructs the same explicitly redacted packet,
preserves surrounding diff content, binds the original full-diff digest and
locations, and verifies an isolated synthetic record through the existing
credential-free verifier. A changed record digest is rejected. Synthetic records
are temporary test fixtures, not reviewer verdicts or product authority.

Independent security review found that invalid UTF-8 could change unrelated
rendered bytes. A real Git text fixture reproduced that failure before the
opt-in lossless-UTF-8 check was added. The completed hostile file passes 23 tests
and 33 assertions, including retained/copy/binary-copy URLs, multiple tokens,
residual credentials, invalid locations, binary hunks and malformed URLs.

The TypeScript source-form tests first reproduced the primitive parameter and
dotted-reference false positives. Further negative tests exposed quoted JSON
credential keys and typed-parameter defaults missed by the prior generic
scanner. Those values now remain blocked. Source lookup verifies the exact
committed side; context lines require agreement on both sides. A separate
RED-to-GREEN test avoids source parsing where no eligible key exists without
skipping the ordinary scanner.

## Complete affected checks

- `bun run review:accept:negative-control`: 124 passes, zero failures, 217
  assertions across seven files. The repository script includes every new
  parser, source-form and historical-redaction test.
- Strict TypeScript with `--noUncheckedIndexedAccess` over the changed packet
  module and historical-redaction test: PASS. This includes their imported
  redaction, diff and source-form modules.
- Warning-denying lint, focused formatting, `bun run skill:check`, and
  `git diff --check`: PASS.
- Every committed protocol-v2 PASS record was reverified through
  `bun run review:accept:verify -- --record <path>` with no model credentials:
  16 passes, zero failures. This checks historical packet identity as well as
  the record verifier. No model was called.

Logs are retained under the local verification directory
`/home/drepkovsky/code/questpie-v4-beta2-verification.l3bsSH` as
`historical-redaction-hostiles.log`, `historical-redaction-types.log`,
`acceptance-safety-full-controls.log`, and
`acceptance-safety-existing-records.log`. These are local provenance, not
portable build prerequisites. Tests use generated synthetic URL tokens only;
the rejected historical credential was neither printed nor sent to a reviewer.

No Runtime, PostgreSQL schema, package export, reviewer profile, fallback,
release budget, or product-authority change is part of this repair. Independent
Standards and Spec/security reviews of `de55e364c..e35682620` found no blocking
or non-blocking findings. The security reviewer independently reran all 124
affected tests. These are repository-quality reviews, not ADR acceptance.
The fresh real-candidate packet preflight passes at `e2a1cbc21`: 1,233,528
original diff bytes, 1,695,267 packet bytes and 38 documents, with the default
`claude-opus-medium-v1` reviewer. The complete diff remains present except for
the one explicitly selected historical URL. No model was invoked.

The preceding `e9807dbdd` preflight rejected the malformed-URL negative fixture's
literal, not the historical redaction. The test now constructs the identical
invalid value at execution time; neither its rejection assertion nor the
scanner changes. All 124 tests and 217 assertions pass again. Independent
Spec/security delta review through `e2a1cbc21` found no findings. This is a
test-source repair, not another secret exemption or a formal review outcome.
