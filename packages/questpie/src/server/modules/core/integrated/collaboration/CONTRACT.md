# Collaborative-document capability contract

Status: design grill in progress. Decision CD-01 was ratified on 2026-07-23.
No implementation or public API is approved by this document yet.

This is the canonical QUESTPIE framework contract for the collaborative-document
capability. Agent Board records execution evidence and links back here; they do
not define a second contract.

## Goal

Define a narrow reusable kernel for concurrent document editing without knowing
application concepts such as Knowledge, Library Entry, Thread, Message, or Tag.
The first driving consumer is Autopilot Knowledge, while later consumers may use
the same capability for Goal or Task document fields.

The complete design must be ratified before implementation. It must cover the
public API, authorization, persistence, transport, client lifecycle, failure
states, tests, and upstream release/consumer gates.

## Verified framework baseline

QUESTPIE Channels already provide typed JSON event schemas, independent
subscribe/publish authorization, presence snapshots, SSE and shared-provider
transports, cross-instance presence leases, commit-ordered event ids, bounded
replay, and TanStack Query channel/presence options.

Channels are not a collaborative-document protocol. Their normative transport
contract explicitly excludes collaborative editing and binary events. They do
not provide CRDT state-vector synchronization, offline document merge, binary
updates, update compaction, editor/CRDT bindings, or durable relative anchors.

The existing defaults also make channel events the wrong update carrier:
server-mediated publish is approximately 10 events/second with 10,000-byte JSON
payloads, while presence is capped at 100 members and 1,024 bytes per member.
The collaboration capability may reuse proven runtime patterns, but it must not
masquerade CRDT updates as ordinary Channel events.

## Ratified decisions

### CD-01 — Narrow transport-neutral kernel with qualified adapters

QUESTPIE owns a deliberately narrow, transport-neutral collaborative-document
kernel. Yjs will be the first qualified CRDT adapter, but the application-facing
contract must not expose `Y.Doc`, Yjs update formats, or a provider-specific
connection API.

Adapter-specific mechanisms such as state vectors, relative positions, update
encoding versions, and editor bindings are declared as adapter capabilities.
They are not mandatory vocabulary for every QUESTPIE application.

Consequences:

- **Public API:** application code speaks in resource identity, snapshot,
  participant mode, awareness, synchronization state, and declared adapter
  capabilities. Exact TypeScript shapes remain open.
- **Authorization:** the framework independently evaluates read and edit
  authority for each Human or Agent. A transport connection, room membership,
  requester authority, or previously accepted update is not an authorization
  grant.
- **Persistence:** QUESTPIE owns adapter-versioned collaboration state in a
  framework namespace. An application continues to own its canonical domain
  representation and checkpoint policy; raw Yjs/Tiptap state cannot become
  Autopilot domain truth.
- **Transport:** collaboration requires a binary-capable synchronization seam
  with explicit limits and fencing. Existing JSON Channel publish is neither
  the wire protocol nor a second source of truth.
- **Client:** QUESTPIE provides a generic collaboration lifecycle and typed
  client surface. Yjs/Tiptap integration is supplied by a qualified adapter
  package behind that surface.

## Current enterprise trace

| UI intent                                                                                                                                       | Framework seam                                                                              | Authorization                                                                                | State ownership                                                                                                                                                 | Client projection                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Two authorized editors see presence, cursors, selections, concurrent edits, deterministic offline merge, and explicit reconnect/degraded states | Transport-neutral collaborative-document kernel with a qualified CRDT and transport adapter | Fresh per-resource read/edit decisions under each participant's own Human or Agent authority | QUESTPIE owns adapter state, synchronization metadata, leases, fencing, compaction and retention; the application owns canonical content and domain checkpoints | Generic provider/store lifecycle plus an optional editor adapter; no raw provider or CRDT API in the application surface |

This trace currently maps to Autopilot
`EA-CONTENT-HEADLESS-AUTHORING`,
`EA-KNOWLEDGE-CANONICAL-LIBRARY-ENTRY`,
`EA-KNOWLEDGE-CREATE-LIVE-DOCUMENT`, and
`EA-ASSET-USAGE-SEPARATION`. Autopilot's existing trace remains the consumer
source for product intent and will be updated only from a clean, isolated
consumer change.

## Frozen non-goals

- No Autopilot-local collaboration backend, persistence tables, or realtime
  protocol.
- No Knowledge, Library Entry, Thread, Message, Tag, Markdown, Tiptap, or Yjs
  concept in the generic application contract unless a later decision
  explicitly qualifies it as an adapter capability.
- No whole-document last-write-wins implementation presented as multiplayer.
- No CRDT operations through ordinary collection CRUD.
- No ambient system authority or requester authority inherited by an Agent.
- No implementation before the full capability contract, walking skeleton,
  negative-oracle matrix, state machine, verification gates, and release plan
  are ratified.

## Open decision queue

The grill resolves one item at a time. The next unresolved item is CD-02: the
first qualified CRDT adapter and whether synchronization-provider behavior is
part of that adapter or a separate transport adapter.

Later decisions cover resource identity, read-only/editor modes, awareness,
binary limits, persistence, state-vector reconnect, snapshots, compaction,
multi-device identity, offline merge, revocation/fencing, validation and
migrations, canonical serialization, relative anchors, client integration,
SSR, failure states, observability, packages, tests, and release consumption.

## Evidence

- `../realtime/TRANSPORT.md`
- `../../../../channels/channel-builder.ts`
- `../../../../channels/service.ts`
- `../../../../../client/channels/types.ts`
- `../../../../../client/channels/index.ts`
- `../../../../../../../tanstack-query/src/channel-query-options.test.ts`
- Autopilot `CONTEXT.md`, `SPEC.md`, `docs/design/screen-map.md`, and
  `docs/architecture/decision-to-delivery-traceability.md`
- Official Yjs document-update, state-vector, relative-position, sync, and
  awareness contracts
