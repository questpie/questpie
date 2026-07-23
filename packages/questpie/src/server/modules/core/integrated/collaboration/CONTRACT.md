# Collaborative-document capability contract

Status: design grill in progress. Decisions CD-01 through CD-03 were ratified
on 2026-07-23. No implementation or public API is approved by this document
yet.

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

### CD-02 — Separate document and transport adapters on current runtime majors

The CRDT/document adapter and synchronization transport adapter are independent
seams. Yjs is the first document adapter. Hocuspocus 4.x is a candidate for the
first WebSocket transport adapter, not part of the kernel contract and not the
owner of authorization or persistence.

The collaboration release targets current supported dependency majors rather
than preserving the old Node 18 or Tiptap 2 baselines:

- QUESTPIE's advertised Node-compatible runtime floor rises to Node 22.
- Bun remains the package manager and primary runtime. Hocuspocus must pass real
  qualification under the exact supported Bun release; its Node engine range is
  not evidence of Bun compatibility.
- The first editor adapter targets Tiptap 3.x. Migrating the existing admin
  editor from Tiptap 2 is an explicit prerequisite with its own regression
  proof, not a hidden collaboration change.
- The first qualified dependency set starts from Yjs 13.x and Hocuspocus 4.x.
  Exact versions are rechecked and pinned after compatibility, security, and
  scenario qualification. Runtime dependencies never use a floating `latest`.
- The currently prerelease `@y/protocols` line for Yjs 14 is not selected merely
  because its package metadata is newer. A future Yjs 14 adapter revision
  requires its own compatibility evidence.

Consequences:

- **Public API:** `DocumentAdapter` and `TransportAdapter` capabilities remain
  independently selectable; exact TypeScript names are still provisional.
- **Authorization:** the kernel performs fresh read/edit decisions and fencing.
  A Hocuspocus token, socket, room, or read-only flag only carries the resulting
  bounded grant and cannot become the policy source.
- **Persistence:** QUESTPIE owns the durable collaboration store and compaction
  rules. Hocuspocus database extensions cannot create a parallel document
  authority.
- **Transport:** Hocuspocus must satisfy binary framing, bounded admission and
  queues, reconnect, revocation, HA, and shutdown qualification. Failure permits
  a different transport adapter without changing document state or app APIs.
- **Client:** the generic lifecycle does not expose
  `HocuspocusProvider`, `Y.Doc`, or Tiptap editor objects. The optional Yjs and
  Tiptap bindings consume the two qualified seams behind that lifecycle.

### CD-03 — Server-resolved resource identity and independent authority

The application exposes a typed, schema-validated resource locator. QUESTPIE
resolves that locator under the current participant's request-bound context and
derives the canonical tenant/resource key on the server. The client never
supplies a provider room name, tenant key, internal document id, authorization
epoch, or fence.

The kernel turns the definition key and resolved canonical resource key into an
opaque, versioned `DocumentRef`. Its exact encoding remains internal and cannot
be used as proof of access. A provider-specific room identifier is derived from
that internal reference and is never application identity or authorization.

Read and edit authority are evaluated independently under the participant's own
Human or Agent principal. A Human request cannot lend authority to an Agent, and
browser collaboration routes cannot use ambient system access. Transport
admission uses a short-lived, purpose-bound, single-use ticket derived from the
server decision. Room membership, a socket, a client-generated id, or a
previously accepted update is not a durable grant.

Consequences:

- **Public API:** a collaborative-document definition declares a locator schema,
  a server resolver, and independent read/edit authorization. Client code passes
  only the typed locator and requested mode. Exact builder names remain open.
- **Authorization:** the resolver and access rules run with fresh
  request-bound context on open and reconnect. Later decisions define
  revalidation cadence and transactional update fencing.
- **Persistence:** framework rows use the internal document reference,
  definition/version metadata, and document epoch. Provider room names and
  application concepts are not persistence identity.
- **Transport:** the adapter redeems an opaque one-use ticket bound to the
  resolved document, participant, requested mode, protocol, epoch/fence, and
  expiry. It cannot resolve arbitrary client room names.
- **Client:** generated APIs expose typed resource locators without internal
  room ids, tenant ids, provider tokens, or authorization metadata.

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

The grill resolves one item at a time. The next unresolved item is CD-04:
the exact contract for requested viewer/editor modes, denial, and mid-session
mode changes.

Later decisions cover awareness, binary limits, persistence, state-vector
reconnect, snapshots, compaction, multi-device identity, offline merge,
revocation/fencing, validation and migrations, canonical serialization,
relative anchors, client integration, SSR, failure states, observability,
packages, tests, and release consumption.

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
