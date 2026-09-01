# Bounded inverse `toMany` adversarial reviews

Status: deterministic candidate evidence, not formal acceptance

These reviews are independent Codex audits of the Proposed candidate. They do
not change ADR status and are not the manifest-bound acceptance review.

## Authority audit — repaired

The audit required ADR-0032 to supersede only ADR-0008's one-hop description
and projected-`toMany` deferral. It found that current Template v1 already
ships recursive `toOne` nodes. The repaired candidate keeps all existing v1
bytes readable and emitted for `toOne`-only graphs, fixes their four-edge
ceiling in authority, and introduces v2 only for the new inverse-list node.

## Compiler and type audit — PASS

The audit confirmed that the accepted inverse Relation stores source identity
but not the source Collection's Field map, so exact ordinary-TypeScript
inference needs a child-owned fragment. It then challenged the public spelling
and recursive type evidence. The replacement uses the existing `list` verb:
root `list` requires `parameters` and `page` and forbids `first`; nested `list`
requires literal `first` and forbids the root members. A variable-based hostile
and runtime guard reject a mixed shape. The proof preserves exact readonly
child rows, optional conditional Fields, nullable nested `toOne`, exact nested
selection, and inverse source identity.

## Runtime and PostgreSQL audit — PASS

The audit required one relational kernel and one PostgreSQL statement, with
Policy before child order/limit, no JSON aggregation, no per-parent statement,
and no partial result. The PostgreSQL 17 tracer proves inverse correlation,
root cursor binding, empty arrays, root sentinel grouping, conditional Field
omission, hostile ordinal rejection, the 5,050-position bound, semantic-byte
failure, read-only repeatable-read ownership, in-flight cancellation, deadline
rollback, and connection reuse. Template v2 and Plans v2 bind the same SQL
export, ordered parameters, result descriptors, Policy digest, statement
digest, App Contract, and Runtime Build used by parity and PostgreSQL evidence.

## Beginner-DX review — BLOCKED, then PASS

The first review blocked a nonexistent `row.kind` Field in the public filter
example and stale `window` terminology in proof symbols. The replacement uses
the declared `body` Field and one canonical `list` vocabulary throughout. The
review then returned PASS: imports, Relation declarations, overload
distinction, page/wrapper guidance, optionality, nullability, and diagnostic
recovery are self-contained.

## Deletion review — BLOCKED, then PASS

The first review rejected a claim that notification code could switch to an
already generated `tickets.get`; that Query does not exist and always-generated
get/list/delete remains deferred. The replacement keeps
`notification.sendTicketSummary` on the existing `tickets.detail`, explicitly
accepts the bounded ignored comments member, and adds no Query or compatibility
surface. The review then returned PASS for the deletion ledger and single
kernel.

## Spec review — blocker sequence

The first review found six holes: conditional Field output, Live change and
replacement evidence, PostgreSQL transaction/cancellation evidence, artifact
and digest representation, exact failure staging, and direct/network/watch
parity. All six received executable repairs.

The next review found four narrower holes: incomplete v2 root/statement
binding, overloads disjoint only for inline literals, a false 10,000-row Query
limit, and ambiguous recursive-v1 compatibility. The replacement binds the
complete root and statement contract, adds explicit `never` members plus a
variable hostile, removes the false limit, and preserves recursive v1 with a
fixed digest vector.

The following review found one remaining mismatch: the v2 vector encoded a
`true` child filter while SQL filtered `body != "filtered"`, and the inherited
root `after` cursor was not bound. The final replacement encodes that exact
normalized child filter, binds `after` in the four-parameter statement, and
executes both null-cursor and resumed-cursor PostgreSQL pages.

That review then narrowed the cursor finding further: the public `after` value
is opaque and cannot itself be compared with `ticket.id`. The final plan now
binds an `afterId` statement parameter from a template-digest-bound
`decodedCursorOrder` descriptor. Readiness verifies the mapping and the
PostgreSQL tracer receives only the decoded `id` boundary.

A fresh final Spec reviewer found one stale sentence in `CANDIDATE.md` that
still called v1 one-hop. After it was aligned with the preserved
recursive-`toOne` v1 contract, the replacement review returned **PASS**.
