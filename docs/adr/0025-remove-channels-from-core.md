# ADR 0025: Remove Channels from the core

- Status: Accepted
- Date: 2026-08-20

## Context

QUESTPIE already has distinct owners for realtime and durable work. Live Query
keeps an authorized Query result current from PostgreSQL Change Ledger facts;
ordinary Collections and Queries own durable business history; Reaction and Job
own durable post-commit or explicitly accepted work.

The earlier Channel contract instead introduced a second durable realtime
system: a compiler Resource, generated codecs and client, PostgreSQL event
identity/order/replay, authority generations, presence semantics, and an
optional carrier binding. That machinery does not fit the application job of
transient typing, cursor, presence, progress, or advisory notifications.

## Decision

QUESTPIE removes Channels from the core product.

- There is no Channel Resource, `defineChannel`, generated Channel client or
  codec projection, PostgreSQL Channel ledger/order/replay/generation, Channel
  presence model, or `runtime.channelCarrier`.
- Live Query is the only built-in continuing client-state mechanism. It sends
  complete current authorized Query results; it is not a generic event bus.
- Durable business events remain ordinary persisted application data queried
  through Policy.
- If an external publish attempt must survive a commit, a Mutation accepts a
  Reaction and the Reaction crosses an Action or external-effect Service
  boundary. Acceptance and attempts are durable and physically at least once;
  provider delivery may remain ambiguous.
- Truly transient connected-client signals are owned by application code and a
  provider such as Pusher, Soketi, Ably, or an application WebSocket service.
  QUESTPIE provides no provider registry, compiler ABI, runtime binding, or
  generated semantic adapter for them.
- Provider subscription authentication, presence, connection lifetime,
  delivery, rate limits, and telemetry cannot authorize QUESTPIE Operations or
  become durable application truth. Business-significant presence is ordinary
  persisted application data evaluated through Policy.
- A reusable provider integration may be an ordinary Package; it earns no core
  framework abstraction.

The collaboration fixture's Company → Space → Channel → Membership → Message
graph remains unchanged. Its `Channel` is an ordinary application Collection
and domain noun, not a framework capability.

## Supersession

This ADR supersedes only the forward Channel projection of ADR-0017, ADR-0019,
ADR-0021, the P14 Channel conformance cell, and their current specification,
gate, build, ownership-map, public-documentation, visual, and wayfinder
projections. Their pinned proof artifacts and review records remain immutable
historical evidence.

## Consequences

- The core has one less Resource, generated surface, PostgreSQL ledger, runtime
  capability, provider seam, conformance cell, and future implementation slice.
- Applications that need ephemeral fanout compose the small provider-specific
  solution they actually need.
- QUESTPIE does not claim replay, ordering, exactly-once delivery, durable
  presence, or operation authority for provider events.

## Rejected alternatives

- Keep the durable Channel ledger while describing it as ephemeral.
- Retain unused `defineChannel` or `runtime.channelCarrier` compatibility seams.
- Rename the concept to Signal, Broadcast, Presence, or a generic event bus.
- Publish a provider matrix or let provider authorization decide Policy.

## Acceptance

The candidate at `ed0dfa7c59e6132a26cc1adaa500ec200ad911c8` received a
fresh stateless Opus-medium `PASS`. The verified review record is committed at
`053690f6` in
[`remove-core-channels/REVIEW-04.json`](../v4/prototypes/remove-core-channels/REVIEW-04.json).
