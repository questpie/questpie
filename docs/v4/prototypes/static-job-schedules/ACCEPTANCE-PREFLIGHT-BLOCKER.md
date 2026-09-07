# Acceptance packet preflight blocker

The fresh manifest at candidate `98e88b57408d47e1801a83ea16c483809dec038a`
failed credential-free packet preparation before reviewer probing or invocation.
`prepareAcceptancePacket` reported `review diff contains a prohibited database
URL`. This is not a formal `BLOCKED` verdict, a `NO_RESULT`, or an acceptance
attempt. No review record was generated and ADR-0043 remains Proposed.

## Exact scope of the rejection

The manifest's complete diff starts at canonical
`97910dac96e0fcc9a7da5c911b8f2534f5eb83b4`. Its removed
`fixtures/team-support-desk/README.md` line 62 contains a loopback database URL
with username and password material. The current README no longer contains that
example. Neither the URL nor its values are reproduced here, in reviewer input,
or in diagnostic output. This inspection did not test the historical credential
against a database and makes no claim about whether it remains usable.

Source-only credential-pattern false positives also occur in the relocated
sign-in function's parameter annotation and the browser tracer's variable
forwarding. Those are separate scanner findings; repairing them alone cannot
make the historical URL eligible for transmission.

The protocol at that rejected head bound the complete diff, including removed
lines, without an approved historical-secret redaction or file-exclusion mechanism. Its narrow
synthetic negative-control exemption does not apply to application files.
Independent read-only authority review confirmed there is no already-authorized
path that preserves the complete review scope and sends no secret material.

## Resume boundary

The owner authorized the focused docs-first change on 2026-09-07. Its
[decision](../../implementation/acceptance-packet-safety/DECISION.md) and
[test evidence](../../implementation/acceptance-packet-safety/EVIDENCE.md) specify
explicit historical URL redaction with original-diff integrity bindings and
unchanged checks on new code. Only that manifest-bound transform is permitted.
Do not move the diff base, omit paths, add arbitrary masks, weaken the scanner,
or invoke another reviewer to evade the rejection. Independent final review and
the fresh candidate preflight must pass before formal submission.

All completed deterministic candidate evidence remains retained. The explicit
64-program PostgreSQL owner proof and calendar-range clarification are committed;
neither changes production source. The one pinned ADR-0043 model review remains
unconsumed. Before any later review, reconstruct the manifest against the then
current committed documents and rerun the affected deterministic preflight.
