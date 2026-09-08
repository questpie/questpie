# Native Query integration: first executable seam

Status: Proposed proof candidate. No public export or authority projection.

The owner approved continuing the [research recommendation](../../research/react-tanstack-integration-2026-09-08/RECOMMENDATION.md)
with Task detail and board as the consumer. This first slice resolves one earlier
blocker: finite TanStack Query fetch over a continuing generated watch, with
bounded observer and scope lifetime. It does not implement the whole adapter.

## Accepted inputs and unchanged owners

ADR-0012 owns complete authorized snapshots and the single Live Query transport.
ADR-0014 owns the generated client. ADR-0023 owns Mutation outcomes and call
identity. ADR-0035 still owns the current Query Resource and React projection;
ADR-0042 still owns public package placement. None is superseded by this file.

The candidate uses native QueryClient/QueryObserver and a watch-shaped external
peer. It does not implement SSE, reconnect, codecs, authorization, SQL, or a
Mutation kernel. It is a Product interface experiment, not a formal Kernel PASS.

## Test seam

Tests consume the candidate's native query options through QueryClient and
QueryObserver, and control only the external watch peer. A synthetic Task detail
is the result. A compiler-supplied key is represented explicitly in this small
experiment; this is not permission for application authors to repeat key or
schema definitions. Generated descriptor identity/types remain R1 work.

The intended observations are:

- a fetch resolves on its first complete snapshot without waiting for watch EOF;
- enabled observers continue receiving complete replacements through the same
  Query cache; additional observers share the active binding;
- a fetch with no continuing observers closes after its first snapshot;
- last-observer removal and disabled-only observation release the binding;
- retirement prevents late callbacks and retained options from reopening work;
- a terminal watch failure removes the previously disclosed cached result.

Transport interruption and reconnect remain owned by the generated watch, not
TanStack retry. The candidate disables Query retry, polling, focus/reconnect
refetch and ordinary stale-time refetch for an actively watched result. These
options are reserved in this experiment; hostile consumer overrides remain a
separate unresolved public-options contract.

## A reset is not a universal authority-change notification

Source inspection of the existing PostgreSQL coordinator found that ordinary
dirty recomputes publish `update` with a null reset reason. `authority-changed`
is selected when a requested resume token fails authority-partition matching.
It cannot be assumed that every reduced authorized result carries that reset.
See [coordinator](../../../../packages/runtime/src/application/realtime/postgres-coordinator.ts)
and [retention](../../../../packages/runtime/src/live-query/postgres-retention.ts).

Therefore a later optimistic layer must also respect omissions on an ordinary
successful update. This experiment publishes whole replacements and adds no
optimistic layer, so it cannot prove that future layer's safety.

## Still blocking the recommended integration

### R1 construction choice

The next experiment uses a generated sibling and a lazy, module-private
scope accessor. Input/output types reference existing generated methods rather
than repeat their codecs. Only declared-error types are newly projected from
the existing declared-error contract. The shared optional adapter owns native
options; the generated client retains canonical capture and invocation.

Keys contain a random scope partition, public Operation identity and an opaque
input slot, not Context or canonical payload bytes. The construction prototype
uses a provisional 128-capture ceiling to make allocation finite. It is not a
ratified adapter limit or a measured capacity recommendation; cache-eviction
and abandoned-options ownership still need closure before production selection.

Native cache key error tags and Mutation options use `unknown`. Query hooks
retain TanStack's default `Error` unless the application configures its native
Register; the [React consumer evidence](REACT-HOOK-EVIDENCE.md) tests both
configurations. An Operation-specific generated predicate narrows declared
errors without wrapping arbitrary transport failures into a closed union.
One-shot transport and error decoding remain the
production renderer's code. No ordinary Query is made watchable by this choice.

This selects the narrow generated-sibling idea from the Opus consultation, not
its proposed raw-input keys, error cause wrapper or per-module counter identity.
The source instrumentation and internal accessor are proof-only, not a new
public ABI. Import compatibility, generation cost, full source compilation,
causal observation and live/Mutation integration remain evidence obligations.

Generated descriptors and declared-error inference, codec-canonical identity,
Task board plus Mutation, ordered optimism, full authorization retirement across
pending writes, conservative dependency closure, post-commit observation,
real-browser lifecycle, PostgreSQL races, optional DB and Start hydration are
not proved here. Native hooks, limited server Suspense and jsdom StrictMode
Query retirement now have [focused evidence](REACT-HOOK-EVIDENCE.md), not full
React lifecycle coverage.
No scope inclusion in beta 2 is inferred from permission to construct this proof.

Production should replace this experiment when the relevant consumer passes;
do not ship a prototype plus a parallel implementation. Follow the existing
[decision map](../../research/react-tanstack-integration-2026-09-08/DECISION-MAP.md)
for the remaining blocking edges.

The [generated watch extension](GENERATED-LIVE-EVIDENCE.md) now connects the
existing SSE client to the finite native Query experiment. Watchability is
projected from the compiler contract, not authored again at the options call.
This closes the synthetic-watch-only gap, not R2's browser or complete authority
lifetime obligations. Its construction-time registry ownership remains open.
