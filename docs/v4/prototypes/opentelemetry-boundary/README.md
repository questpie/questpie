# Runtime observation and OpenTelemetry proof

Status: executable candidate evidence for Proposed ADR-0033

This directory tests the narrow architecture claims that prose alone cannot
settle. It is not production implementation and does not project ADR-0033 into
Accepted authority.

The proof is split by owner:

- `observation-kernel/` tests one root Execution identity, nested semantic
  scopes, async context, suppression, Envelope v2, fail-open adapter behavior,
  streaming lifetime, and callback limits;
- `artifacts/` tests the canonical signal/config projection, version and digest
  binding, exact supported environment subset, and hostile attribute/config
  rejection; and
- `durable-link/` tests first-successful Job and Reaction acceptance context,
  duplicate/rollback behavior, sibling attempt links, protocol-v8 cutover, and
  PostgreSQL persistence.

`BOUNDARY.md` and `SIGNALS.md` are normative candidate inputs. The executable
proof may falsify them; it cannot silently replace them. Any mismatch must be
reconciled before the candidate head is committed.

`staging-check.ts` and `authority-projection.json` keep live authority and
production unchanged while the ADR is Proposed and bind the exact post-PASS
projection. The acceptance manifest is generated only from a clean committed
candidate head after every focused test, strict typecheck, lint, format check,
PostgreSQL 17 tracer, architecture check, docs build, and `git diff --check`
passes.
