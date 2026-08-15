# BETA-04 authority revision candidate

This proof proposes one later sibling authority record,
`P2R1/BETA04Authority`. It does not amend the identity, accepted head, packet,
or canonical artifact digests of the original P2 proof.

## Bounded revision

- ADR-0008 gains `DataCursorV2` only for Policy-protected Query execution.
  `DataCursorV1` remains byte-for-byte frozen and is never reinterpreted.
  Cursor v2 adds the sibling `policyScopeDigest`; the Policy scope contains the
  Policy Program Digest and only compiler-reached Principal, Tenant, and
  Authority facts. Canonical bytes, LF, SHA-256 domain, unpadded base64url,
  2,048-byte bound, validation precedence, and nondisclosing recovery are exact
  in `REVISION.json`.
- ADR-0010 promotes exactly `QP-POLICY-001 missingDefaultPolicy` and
  `QP-POLICY-002 ambiguousDefaultPolicy`. Both are fatal compile diagnostics.
  They never encode row denial, Relation denial, cursor rejection, or a
  PostgreSQL outcome. No additional `QP-POLICY-*` spelling is accepted.
- The internal and public Context/Data pages project those decisions without
  creating Policy-free execution, bearer Authority, RLS, raw SQL, aggregate,
  backward-pagination, or provider-matrix authority.
- BETA-04 becomes the sole agent-ready tracer only because the merge heads for
  BETA-01 through BETA-03 are pinned. Readiness is derived from accepted
  predecessors, never from an isolated Boolean edit.

## Exact projection

`PROJECTION.patch.b64` is a lossless envelope around the byte-exact proposal
from commits `22379c76` and `32b1e444`. `READINESS.patch.b64` losslessly wraps
the repair for the incomplete P16 promotion by adding
accepted-issue evidence, clearing completed BETA-01 readiness, deriving one
next issue, and adding non-inert negative controls. The proof runner applies
both patches to the exact base in a disposable worktree and runs the resulting
P16 positive and negative gates.

Only after a fresh stateless Opus-medium `PASS` may these reviewed patches be
projected into the ADRs, internal/public pages, design context, and P16 queue.
The accepted review is then recorded beside this candidate and as a sibling
P2R1 entry in `PROOF-MAP.md` and `HANDOFF.md`; the original P2 row remains
unchanged.
