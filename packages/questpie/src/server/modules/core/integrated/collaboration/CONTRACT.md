# Collaborative-document capability contract

Status: design grill in progress. Decisions CD-01 through CD-04 were ratified
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

### CD-04 — Explicit viewer/editor grants and downgrade behavior

Opening a collaboration session requests an explicit `view` or `edit` mode.
`view` requires current read authority. `edit` requires both current read and
edit authority. An edit request is not silently downgraded: the consumer must
explicitly opt into a viewer fallback, and the session always reports the mode
that the server actually granted.

Losing edit authority immediately fences the old edit grant and rejects queued
or racing writes before durable append. A session that explicitly allowed
viewer fallback may continue as a viewer only when it has no unconfirmed local
changes. If unconfirmed changes exist, it enters a recovery-required state and
preserves them for an explicit export/recovery flow; it never discards or
uploads them under revoked authority.

Losing read authority terminates document synchronization and awareness
delivery. A viewer is never elevated automatically when edit authority later
appears; elevation requires an explicit reauthorization/open operation.

Consequences:

- **Public API:** session open declares the requested mode and an optional,
  explicit viewer fallback. The resulting lifecycle exposes the granted mode
  and typed denied, revoked, and recovery-required outcomes.
- **Authorization:** read and edit decisions remain independent. Transactional
  update fencing, grant expiry, and revalidation cadence are specified by later
  decisions.
- **Persistence:** every durable update is attributed to an active editor grant
  and document epoch/fence. Viewer sessions cannot append update rows.
- **Transport:** granted mode is a bounded kernel decision carried by the
  transport, not a provider-owned read-only policy. Revocation closes or
  downgrades the relevant transport session after the durable fence advances.
- **Client:** editor bindings stop accepting mutations before a downgrade is
  exposed. Pending local work survives only through an explicit recovery
  state; automatic elevation and silent fallback are prohibited.

### CD-05 — Lease-backed roster and bounded ephemeral awareness

The participant roster and high-frequency awareness are separate framework
concepts. The roster is derived from active, lease-backed collaboration
sessions and exposes only server-derived participant identity, granted mode,
and a disclosure-safe profile. Awareness is session-scoped, ephemeral,
lossy, latest-wins state such as cursor, selection, focus, or viewport. It is
not a document update, durable history, checkpoint, or audit event.

Current read authority is required to send or receive roster and awareness
state. The client cannot claim participant identity, granted mode, tenant,
role, or other server-owned fields. Each collaborative-document definition may
declare a bounded awareness schema. Adapter capabilities may carry opaque
relative anchors inside that schema without exposing provider formats to the
application.

The initial defaults are:

- at most 1,024 serialized bytes of client awareness per session;
- at most 20 accepted awareness updates per second per session, with outbound
  latest-state coalescing;
- at most 100 active sessions per document;
- a 10-second heartbeat and 30-second lease expiry.

Disconnect and revocation remove local awareness immediately; expiry heals
owner crashes and missed teardown. Multiple tabs or devices remain distinct
session entries, while the client projection may group them under one
server-derived participant. Awareness payloads are never written to the
document update log, checkpoints, immutable audit history, or diagnostic logs.

Consequences:

- **Public API:** definitions expose a typed awareness schema and a
  server-side participant profile resolver. Session projections distinguish
  grouped participants from individual session awareness.
- **Authorization:** read authority gates both directions. Edit authority is
  not required merely to appear in the roster or publish schema-valid viewer
  awareness.
- **Persistence:** QUESTPIE may keep current lease rows for HA recovery, but
  they are expiring operational state with no historical meaning.
- **Transport:** awareness uses a separately limited latest-wins delivery
  class. Document updates remain ordered, non-coalescing, and durable.
- **Client:** cursors and selections disappear on close, revoke, or expiry and
  are never replayed as offline document work. Profile fields are trusted only
  when supplied by the server.

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

## Mapping to existing QUESTPIE primitives

The collaboration kernel is a sibling deep module, not a second infrastructure
stack. Every implementation task must classify its relationship to existing
framework code as direct reuse, extracted pattern, or deliberately separate.

| Collaboration concern                            | Existing primitive                                                                                              | Mapping decision                                                                                                                                                                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typed definition and generated registry          | `server/channels/channel-builder.ts` and the plugin-driven category/codegen system                              | **Extract pattern.** Add a collaboration definition/category; do not encode documents as `channel()` definitions.                                                                                                                      |
| Request-bound Human/Agent authority              | `resolveContext`, `AppContext`/`Principal`, and `executeAccessRule` used by realtime routes and collection CRUD | **Direct reuse.** Collaboration adds independent read/edit operations and forbids browser/system authority.                                                                                                                            |
| Canonical resource resolution                    | `resolveChannelName` and registry-first entity resolution                                                       | **Extract pattern.** Use schema-canonical server resolution in a separate document identity namespace; never accept provider room names.                                                                                               |
| Opaque tickets, generations, leases, and fencing | `RealtimeTopologyCoordinator`, its token/identity hashing, owner generation, and lease checks                   | **Extract pattern.** Collaboration owns document/session fences and one-use grants; realtime topology sessions are not authorization records.                                                                                          |
| Cross-instance wake-up                           | `ChangeBroker` and metadata-only `ChangeWake` normalization                                                     | **Direct reuse of the notice seam.** Add only bounded collaboration-advanced/revoked metadata in core; do not change broker adapters or send CRDT bytes through them. Missing wakes remain legal because the durable store reconciles. |
| Commit-ordered durable append                    | `ChannelEventLedger`, `questpieChannelHeadTable`, and realtime outbox head locking                              | **Extract pattern.** Collaboration gets its own `bytea` update/snapshot tables, per-document head, retention, and compaction. Channel replay and JSON events are not reused.                                                           |
| Session admission and bounded work               | `RealtimeAdmissionRegistry`, `createConcurrencyLimiter`, and realtime admission config validation               | **Direct reuse or neutral extraction.** Limits are keyed by server-resolved principal/session, never client ids.                                                                                                                       |
| HA roster leases                                 | `SseChannelPresenceRegistry` and `questpieChannelPresenceTable`                                                 | **Extract pattern.** Collaboration keeps session-granular roster/awareness leases with different schemas, rates, privacy, and expiry semantics.                                                                                        |
| Ordered/backpressured delivery                   | `ClientSink`, `SseOrderedDeltaWriter`, overflow errors, and idempotent shutdown patterns                        | **Extract pattern.** Document frames use a bounded non-coalescing binary FIFO; only awareness may use latest-wins coalescing.                                                                                                          |
| Reconnect and fresh principal resolution         | `EdgeSessionInput.resolvePrincipal`, `RealtimeMultiplexer`, and `realtimeReconnectDelay`                        | **Extract pattern.** Collaboration has its own binary sync proof, offline queue, acknowledgements, epochs, and recovery state machine.                                                                                                 |
| Observability                                    | `RealtimeObserver`/`RealtimeObservability` bounded-reason conventions                                           | **Extract convention.** Collaboration observations use separate event types and disclosure-safe labels; document ids, keys, payloads, participants, and awareness never become labels.                                                 |
| TanStack integration                             | TanStack Query realtime reducers and the new TanStack DB package                                                | **Deliberately separate for mutable CRDT state.** Query/DB may consume canonical checkpoint metadata, but they do not own the live replica, awareness, or offline update queue.                                                        |

The following existing surfaces are explicit non-reuse boundaries:
`ChannelEventLedger`, `/channels/publish`, JSON channel schemas, channel replay
retention, `RealtimeStreamEvent`, latest-snapshot coalescing, provider presence
identity, ordinary collection CRUD, and provider-side persistence extensions.

## Provisional API sketch

These examples make the ratified seams concrete. Names remain provisional until
the complete capability contract is ratified; later decisions may narrow them
but must not expose provider, room, CRDT, or transport internals to application
code.

### Application definition

```ts
// questpie/server/collaboration/article-body.ts
import { collaborativeDocument } from "questpie/collaboration";
import { z } from "zod";

export default collaborativeDocument("article-body")
	.locator(z.object({ articleId: z.string().uuid() }))
	.resolve(async ({ locator, ctx }) => {
		const article = await ctx.collections.articles.findById(locator.articleId);
		if (!article) return null;

		// tenantKey/resourceKey are derived from trusted server state.
		return {
			tenantKey: article.workspaceId,
			resourceKey: article.id,
		};
	})
	.authorize({
		read: async ({ resource, ctx }) =>
			ctx.services.permissions.canReadArticle(resource.resourceKey),
		edit: async ({ resource, ctx }) =>
			ctx.services.permissions.canEditArticle(resource.resourceKey),
	})
	.participant(async ({ principal, ctx }) => ({
		// The kernel owns the opaque participant id and granted mode.
		displayName: await ctx.services.profiles.displayName(principal),
	}))
	.awareness(
		z.object({
			focused: z.boolean().optional(),
			viewport: z.enum(["editor", "preview"]).optional(),
		}),
	);
```

The definition does not return a provider room, token, `Y.Doc`, socket, or
tenant supplied by the client. A cursor/selection binding is added through a
qualified adapter capability rather than serializing provider positions in this
generic schema.

### Runtime adapter selection

```ts
// questpie.config.ts
import { runtimeConfig } from "questpie/app";
import {
	hocuspocusTransportAdapter,
	yjsDocumentAdapter,
} from "@questpie/collaboration-yjs/server";

export default runtimeConfig({
	db: { url: process.env.DATABASE_URL! },
	collaboration: {
		document: yjsDocumentAdapter(),
		transport: hocuspocusTransportAdapter(),
	},
});
```

The configuration values are opaque qualified adapters. Feature code cannot
call them or depend on their provider types.

### Generated client

```ts
const document = await client.collaboration.articleBody.open(
	{ articleId },
	{ mode: "edit", fallback: "view" },
);

const unsubscribe = document.subscribe((state) => {
	if (state.status === "ready") {
		console.log(state.mode); // "view" | "edit"
	}
	if (state.status === "recovery-required") {
		showRecoveryAction(state.exportPendingChanges);
	}
});

document.setAwareness({
	focused: true,
	viewport: "editor",
});

await document.close();
unsubscribe();
```

The candidate lifecycle projection is:

```ts
type CollaborationSessionState =
	| { status: "authorizing" }
	| { status: "connecting" }
	| { status: "synchronizing"; mode: "view" | "edit" }
	| { status: "ready"; mode: "view" | "edit" }
	| { status: "offline"; mode: "view" | "edit"; pendingChanges: number }
	| { status: "degraded"; reason: string }
	| { status: "recovery-required"; reason: string }
	| { status: "fenced"; reason: string }
	| { status: "failed"; error: CollaborationError }
	| { status: "closed" };
```

### Qualified editor binding

```ts
import { RichTextEditor } from "@questpie/ui/rich-text";
import { createTiptapCollaborationBinding } from
	"@questpie/collaboration-yjs/tiptap";

const binding = createTiptapCollaborationBinding(document);

<RichTextEditor
	document={binding}
	readOnly={document.state.status !== "ready" ||
		document.state.mode !== "edit"}
/>;
```

The binding consumes a private document port. Application code still does not
receive `Y.Doc`, `HocuspocusProvider`, state vectors, relative-position bytes,
or transport handles. The exact package split and Tiptap migration remain open
release decisions.

### Internal document and transport seams

```ts
interface CollaborationDocumentAdapter {
	readonly id: string;
	readonly version: number;
	readonly capabilities: ReadonlySet<
		"offline-merge" | "relative-anchors" | "differential-sync"
	>;

	stageInbound(input: {
		snapshot: Uint8Array;
		update: Uint8Array;
		limits: CollaborationUpdateLimits;
	}): Promise<StagedDocumentUpdate>;

	applyCommitted(input: {
		snapshot: Uint8Array;
		update: PersistedDocumentUpdate;
	}): Promise<Uint8Array>;

	createSync(input: {
		snapshot: Uint8Array;
		peerProof?: Uint8Array;
	}): Promise<ReadonlyArray<Uint8Array>>;
}

interface CollaborationTransportAdapter {
	start(handler: {
		open(ticket: string, connection: CollaborationConnection): Promise<void>;
		receive(connectionId: string, frame: Uint8Array): Promise<void>;
		close(connectionId: string): Promise<void>;
	}): Promise<void>;

	stop(): Promise<void>;
}
```

`stageInbound` must not mutate a broadcast-visible replica. The kernel owns the
sequence `authorize/fence -> stage/validate -> durable append -> apply ->
acknowledge/broadcast`. CD-06 and later decisions freeze exact frame, limit,
sync, snapshot, and acknowledgement contracts.

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

The grill resolves one item at a time. The next unresolved item is CD-06:
binary update framing, decompressed-size and structural limits, admission,
backpressure, and slow/malicious client behavior.

Later decisions cover persistence, state-vector reconnect, snapshots,
compaction, multi-device identity, offline merge, revocation/fencing,
validation and migrations, canonical serialization, relative anchors, client
integration, SSR, failure states, observability, packages, tests, and release
consumption.

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
