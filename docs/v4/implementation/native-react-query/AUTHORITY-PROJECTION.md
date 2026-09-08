# Native React Query authority projection

The committed ADR-0044 record passes `review:accept:verify`. Its PASS ratifies
the architecture, not production extraction or aggregate beta.2. This separate
projection changes ADR status/index, SPEC, glossary, current handoff, preview
documentation and skill recommendations. Existing production exports remain
unchanged until the consumer migration in [PLAN.md](PLAN.md).

## Review follow-ups

The formal record is preserved unchanged. Its six non-blocking observations
have these owners:

| Observation                         | Disposition                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hash dependency placement           | ADR packaging clause selects bundled optional-adapter code inside `questpie`; NRQ-01/05 prove licensing and relocated core-only/native consumers. |
| Descriptor version drift            | HANDOFF and DECISION-MAP identify current prototype v4. Earlier evidence stays historical; no version compatibility path.                         |
| Proposed index placement            | Checked source: candidate was under `## Proposed`, not Accepted. Move to Accepted only after committed record verification.                       |
| Host-specific temporary path        | NRQ-02 owns portable production runner and documented `TMPDIR`; frozen candidate remains reproducible only under its recorded host constraint.    |
| Narrative in manifest gates         | Preserve reviewed manifest. Future manifests use executable commands in gate entries and keep ordinary reviews in prose.                          |
| Ordinary/infinite browser readiness | NRQ-03 requires actual browser controls for these modes; native-only prototype tests are not relabelled browser evidence.                         |

## Ordinary public-documentation review

Three independent read-only `claude -p` tasks used `claude-opus-5`, medium
effort, no tools, no session persistence and no fallback. Their axes were fact
coverage, prose, and examples/navigation. They reviewed the new explanation,
affected public pages, glossary and accepted architecture. These are ordinary
documentation reviews, not additional architecture verdicts.

Verified omissions are repaired: public retirement failure name and
nondisclosure; idempotent/conflicting rebinding; version refusal; per-invocation
Call Identity; lazy input capture; scope-key isolation; native status versus
connection metadata; bootstrap handling; dependency ownership. Prose now names
the actor, uses one-shot terminology and distinguishes republishing data from
restoring a saved snapshot. Navigation and preview availability agree.

Two suspected unsupported names were checked against executable candidate
source: `query-adapter.ts` implements async `dispose()` and callable operation
`isError`; `factory-seam.types.ts` strictly consumes both operation maps and
error narrowing. They are not invented APIs. A real stale statement about
network-client keys was corrected against the production client renderer:
kind-grouped scope methods use qualified names, while Resource Identity retains
the kind prefix. Server nested calls are a distinct surface.

The new page is an explanation, with no speculative code sample. NRQ-04/05
must supply executed production and packed Barbershop tutorials before release.
The old public hook example and its packed-doc selector become a neutral Query
Resource example, which still has a current non-React consumer. Native React
packed tutorials remain NRQ-04/05 work; no old hook alias is taught.

## Verification

`bun run types:check` and `bun run build` in `apps/docs` pass after the verified
review findings. Changed-file formatting, `format:ratchet`, record verification
and `git diff --check` pass. `skill:check` and the focused public-skill tests pass.
The packed skill-example test first fails on the removed old hook marker, then
passes with the neutral example: one test / nine assertions. Its temporary
consumer is cleaned. This does not certify a packed native React adapter.
This page records no native production package or release PASS. Current release
blockers remain in PLAN.md.
