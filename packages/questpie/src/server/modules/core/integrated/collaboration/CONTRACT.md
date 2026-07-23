# CRDT field capability contract

Status: ratified on 2026-07-23 after grill, two broad adversarial rounds, P0
amendments, and unanimous focused closure (`security/protocol`,
`distributed/storage`, and `API/release`: GO).

This is the canonical QUESTPIE framework contract for CRDT-backed fields.
Agent Board stores the execution graph and evidence; it does not define a
second architecture.

## Goal

Add a narrow CRDT primitive to QUESTPIE fields so concurrent state works across
arbitrary collections and globals. It must not know about an editor, React,
Tiptap, Markdown, Knowledge, Goal, Task, Thread, Message, or any other consumer
domain.

The first vertical slice is collaborative text backed by Yjs. The same kernel
must serve fields such as `articles.content`, `goals.description`, and
`tasks.notes`. QUESTPIE owns authorization, durable CRDT state, synchronization,
offline recovery, fencing, compaction, and canonical field projection.
Applications remain responsible for the meaning and presentation of the field.

## Baseline and reuse boundary

QUESTPIE realtime already has qualified PostgreSQL change notices, reconnect
reconciliation, commit-ordered snapshot delivery, leases, fencing, bounded
writers, and additive TanStack integration. It is not a CRDT protocol.

CRDT updates must not be encoded as Channel events, realtime collection
snapshots, TanStack Query deltas, or ordinary CRUD writes. The CRDT capability
uses the same qualified physical notice infrastructure only after extracting a
single core-owned multicast notice router. It owns a separate durable log,
per-document cursor, snapshots, epochs, sessions, and binary protocol.

| Concern | Decision |
| --- | --- |
| Collection/global/field registry and generated types | Add a type-preserving core field capability and derive generated projections from owner field maps. |
| Principal and access evaluation | Preserve the authentication discriminant and add an open Human/Agent actor seam; reuse access execution with a fresh context per decision. |
| Physical PostgreSQL/Redis wake transport | Reuse behind one multicast router started once. Broker adapters remain unchanged. |
| Commit ordering, leases, reconnect, bounded delivery | Extract proven patterns, not state or cursors. |
| Realtime outbox, txid, collection snapshot, Channel ledger | Deliberately separate. |
| TanStack Query and TanStack DB | Canonical field projections may flow through them; the live CRDT replica never does. |
| Awareness/presence | Separate CRDT session leases and ephemeral state; do not reuse provider presence identity. |

## Design decisions

### CD-01 — The primitive is a field capability, not an editor framework

A CRDT-enabled field is a normal QUESTPIE collection or global field with an
additional `.crdt()` capability. Its canonical database column remains the
application-facing value. Framework-owned CRDT tables hold operational merge
state.

Version 1 qualifies only a top-level, non-localized, non-array, non-virtual,
non-null PostgreSQL `text` field with identity encoding and default `""`.
`textarea().default("").required()` is the supported builder baseline. Varchar
limits, localization, workflow/stage variants, transforms, custom
`toDb`/`fromDb`, value hooks/refinements, objects, arrays, nested paths, and
custom field types fail at type level where possible and at startup otherwise.
Existing `NULL` values require an explicit CLI-generated backfill before
activation.

The public client surface exposes a small text-replica port rather than
`Y.Doc`, provider rooms, sockets, or editor objects. Canonical text is a
well-formed JavaScript string with no normalization, U+0000, or unpaired
surrogates. Indices and lengths are UTF-16 code units and must fall on scalar
boundaries. Mutations use an atomically prevalidated operation list:

```ts
document.text.apply([
	{ type: "insert", index: 0, value: "Shared " },
	{ type: "delete", index: 12, length: 3 },
]);
```

Operations apply in order to a private candidate and either all become one
speculative local update or none do. Future formats such as map/list require
separate qualification and are not implied by v1.

There is no Tiptap, ProseMirror, rich-text schema, React binding, Hocuspocus, or
UI package in this goal. A consumer may bind any UI to the generic text port.

### CD-02 — Field declaration and generated identity

The candidate declaration is:

```ts
export const articles = collection("articles").fields(({ f }) => ({
	title: f.text(200).required(),
	content: f
		.textarea()
		.default("")
		.required()
		.crdt({
			format: "text",
			awareness: z
				.object({
					cursor: z.number().int().nonnegative().optional(),
					selectionEnd: z.number().int().nonnegative().optional(),
					focused: z.boolean().optional(),
				})
				.strict(),
		}),
}));
```

Codegen derives a registry entry from collection/global key plus field path.
The client passes only the normal typed record locator (`{ id }` for the first
slice). V1 supports exactly one CRDT application namespace per database. It is
an immutable bounded config value, not inferred from URL, deployment, hostname,
or a rotatable secret. A singleton DB row with a fixed key is inserted on an
empty install and must exactly match thereafter; mismatch fails startup. Shared
database multi-application namespaces are a future contract. The server derives
a versioned internal document reference from:

- explicit application namespace;
- definition kind and key;
- canonical record/global identity plus immutable resource-incarnation UUID;
- field path;
- identity contract version.

V1 bounds namespace/owner key to 64/128 ASCII bytes, field path to 256 UTF-8
bytes, and the schema-canonical record locator to 4 KiB. Values are validated
before hashing, persistence, access lookup, or worker admission.

The client never supplies a room, tenant, document hash, epoch, fence, or
adapter version. Identity canonicalization is schema-validated, bounded, and
versioned. A future identity-version migration must map old references
explicitly; it must not silently create a second document.

One resource-level row enforces exactly one current incarnation for
`(namespace, owner kind/key, canonical locator)`, shared by all CRDT fields of
that owner. One partial unique invariant permits only one active binding for
`(namespace, owner kind/key, locator, fieldPath)` regardless of incarnation.

Collection create allocates the resource incarnation and seeds all CRDT fields
in the same transaction. Existing records/globals lazy-activate exactly once by
locking the owner row, rereading the canonical string, and creating the
resource, bindings, documents, and verified initial snapshots atomically.
Adding a CRDT field reuses the current owner incarnation. Global identity has
one explicit incarnation.

Hard delete permanently retires the incarnation; recreate with the same
external id allocates a new UUID and old updates are recovery-only. Soft delete
preserves but retires the incarnation. Ordinary undelete rejects. Only generated
restore/replace may atomically reactivate it under owner→sorted document locks,
advance epoch plus read/edit fences, and write verified basis, canonical text,
hash, and revision. Owner or field rename requires an explicit identity mapping
migration and otherwise fails preflight.

### CD-03 — Canonical value, CRUD, and projection

The collection/global column is canonical application data. The CRDT snapshot
and update log are operational merge state, not a second domain truth.

Rules:

- collection create must seed the binding/document/snapshot in the owner
  transaction; existing rows/globals use the atomic lazy activation in CD-02;
- ordinary update, upsert, bulk, nested, seed, import, version restore, and
  system-mode paths containing a CRDT field always reject as soon as the schema
  declares the capability;
- CRUD may update unrelated fields normally;
- the document owns `canonicalValueHash`, exact `canonicalRevision`,
  `projectedEpoch`, and `projectedSeq`; unrelated owner writes do not change
  them;
- explicit import/restore/agent replacement uses generated
  `ctx.crdt.collections.<owner>.<field>.replace()` or the global equivalent
  with expected epoch/revision, and atomically writes canonical text, a verified
  new-epoch snapshot, hash/cursor, and fences;
- direct last-write-wins mutation of the CRDT field is rejected;
- reads continue to return the last successfully projected canonical value.

For `format: "text"`, canonical projection is the exact Unicode string produced
by the qualified adapter after deterministic validation. Markdown parsing,
normalization, typed references, and product checkpoint policy are consumer
concerns and are not required by the CRDT primitive.

A projection work item carries document, binding/incarnation, epoch E, sequence
P, and expected canonical revision/hash. It captures a verified basis through
P, materializes and validates it, then locks owner row before CRDT document.
In one transaction it verifies the current active binding/incarnation,
`document.epoch === E`, `P <= headSeq`, and expected revision/hash; compares the
ordered pair `(projectedEpoch, projectedSeq)`; writes exact text; advances the
field-specific hash/revision/pair; and emits exactly one normal realtime/outbox
change with `origin: "crdt_projection"`.

Old-epoch/incarnation work and work not newer than the projected pair are stale
idempotent no-ops, not conflicts. A same-epoch raw owner-field mismatch suspends
writes. Replace initializes projected epoch/sequence atomically with its
canonical value and verified basis. The projector uses a dedicated internal
column-write seam: no access callback, mutation/value hook, version snapshot, or
fabricated user principal runs. A future projection hook requires a separate
contract.

The first unprojected update gets `dueAt <= committedAt + 5s`; later updates
cannot postpone it, while session close may accelerate it. The deadline is an
enqueue/attempt SLO in a healthy runtime, not a completion promise through a DB
outage. Raw owner-field mismatch means authority divergence: the document
enters `write_suspended` and no further edits are accepted until explicit
replace. The projector never overwrites a newer ordinary or out-of-band value.

Every operation touching both states locks owner row first and CRDT document
rows second in sorted order. Owner delete retires/fences documents in the same
transaction so neither append nor projector can write after deletion.

### CD-04 — Authentication principal and Human/Agent actor authority

The closed legacy `Principal.kind` authentication union remains
`user | oauth | system` so this 3.x minor does not break exhaustive consumers.
CRDT uses a separate additive authentication envelope and exposes its actor to
access contexts:

```ts
type AuthorityActor =
	| { kind: "human"; subjectId: string }
	| {
			kind: "agent";
			subjectId: string;
			credentialId: string;
			issuer: string;
			scopes: readonly string[];
			expiresAt: Date;
	  };

type CrdtAuthentication =
	| {
			principal: Extract<Principal, { kind: "user" | "oauth" }>;
			verifiedAgentCredential?: never;
			actor: Extract<AuthorityActor, { kind: "human" }>;
	  }
	| {
			principal: undefined;
			verifiedAgentCredential: {
				credentialId: string;
				subjectId: string;
				issuer: string;
				scopes: readonly ("crdt:read" | "crdt:edit")[];
				expiresAt: Date;
			};
			actor: Extract<AuthorityActor, { kind: "agent" }>;
	  };
```

User sessions derive a Human actor. OAuth may act as the same Human subject with
a distinct credential/audit id and shares that user's admission/revocation
subject; it cannot evade caps. A headless Agent never fabricates a user,
session, or OAuth principal. Its dedicated verifier produces the second
envelope branch. `crdt:read` is mandatory for view and `crdt:read` plus
`crdt:edit` for edit. Scope and expiry are rechecked on every fresh decision and
remain additional gates, never replacements for application access. Legacy
user-only callbacks see `principal: undefined` for an Agent and fail closed;
Agent-aware rules use `actor`. System or a missing verified envelope is rejected
before resource resolution.

Access and field-access contexts expose `principal` and `actor`. Read rules run
against the freshly loaded exact row/global and any `AccessWhere` must match that
target. Edit reuses the owner update rule fail-closed with the current raw
record and a frozen empty ordinary input; a patch-dependent rule that throws or
requires field input denies CRDT editing and must be rewritten explicitly.
Field update access runs separately. Optional `.crdt().access.edit` is an
additional AND gate and cannot elevate ordinary access.

No long-lived session captures its opening `AppContext`, tenant, organization,
or access result. Reconnect, update, outbound sync batches, awareness, roster,
and heartbeat revalidation rebuild both the principal and app context.
Ambient ALS context and `accessMode: "system"` are forbidden.

Browser ticket issue requires a syntactically valid `Origin`, canonicalized by
URL origin serialization, and exact-matches the configured app origin or
explicit `crdt.allowedOrigins`. Missing/`null` Origin, userinfo, path, query,
fragment, trailing-dot ambiguity, untrusted forwarded-host derivation, and
nonmatching canonical origin reject. Default ports and host case follow URL
origin serialization.

Headless Agent uses a separate `/agent-ticket` flow selected only by a verified
Agent bearer credential configured as `crdt.authenticateAgent`, never by
missing Origin. That flow rejects cookies, binds audience, credential, actor,
namespace and scopes, and does not treat Origin as authority. A browser cookie
request without Origin cannot fall through to Agent authentication.

Immediate revocation is available only through a transaction-aware authority
mutation seam. Application permission/owner rows lock first, affected CRDT
documents lock second in sorted order, and the subject/document fence advances
in the same transaction:

```ts
await ctx.crdt.withAuthorityMutation(
	[
		ctx.crdt.collections.articles.content.authorityTarget(
			{ id },
			{ subject, capability: "read" },
		),
	],
	async (tx) => {
		await updatePermission(tx);
	},
);
```

The generated single-resource convenience is:

```ts
await ctx.crdt.collections.articles.content.revoke(
	{ id },
	{ subject, capability: "edit", tx },
);
```

It is legal only inside a transaction that follows the same lock order.
Multi-document inputs are sorted by internal id before locking.

```ts
await ctx.crdt.collections.articles.content.status({ id });
await ctx.crdt.collections.articles.content.replace(
	{ id },
	{
		value,
		expected: { epoch, canonicalRevision },
		reason: "agent" | "import" | "restore" | "resolve",
	},
);
```

Global variants omit `{ id }`. Results expose string-encoded
`epoch/headSeq/projectedSeq/canonicalRevision` plus typed status; internal
document references never cross the seam.

Opaque external access callbacks without this seam honestly guarantee
revalidation before the next accepted update/outbound batch and within
15 seconds for idle sessions, not instantaneous revocation.

### CD-05 — Explicit modes and client lifecycle

A session requests `view` or `edit`. Edit requires both read and edit authority.
There is no silent downgrade or elevation. An explicit `fallback: "view"` may
continue only when the local adapter reports no pending updates; otherwise the
client enters `recovery-required`.

The generated constructor is synchronous and inert. It performs no network,
ticket, Worker, or IndexedDB operation during SSR or render:

```ts
const document = client.crdt.collections.articles.content.document({ id });
const globalDocument =
	client.crdt.globals.siteSettings.content.document();

const unsubscribe = document.subscribe((state) => {
	if (state.status === "ready") {
		console.log(document.text.value(), state.grantedMode);
	}
});

await document.connect({ mode: "edit", fallback: "view" });

document.text.apply([{ type: "insert", index: 0, value: "Shared text" }]);
```

The immutable, data-only state union is:

```ts
type CrdtDocumentState =
	| { status: "idle" }
	| { status: "authorizing" }
	| { status: "connecting" }
	| { status: "synchronizing"; requestedMode: "view" | "edit" }
	| {
			status: "ready";
			grantedMode: "view" | "edit";
			pendingUpdates: number;
	  }
	| {
			status: "offline";
			grantedMode: "view" | "edit";
			pendingUpdates: number;
	  }
	| {
			status: "recovery-required";
			reason:
				| "epoch_changed"
				| "offline_horizon_expired"
				| "pending_update_rejected"
				| "owner_retired"
				| "field_contract_changed"
				| "queue_limit"
				| "local_store_corrupt";
			pendingUpdates: number;
	  }
	| {
			status: "suspended";
			reason:
				| "canonical_conflict"
				| "document_limit"
				| "engine_quarantined";
			pendingUpdates: number;
			readable: true;
	  }
	| {
			status: "denied";
			code: "CRDT_UNAVAILABLE" | "CRDT_EDIT_NOT_ALLOWED";
	  }
	| {
			status: "failed";
			code:
				| "CRDT_PROTOCOL_REJECTED"
				| "CRDT_RATE_LIMITED"
				| "CRDT_TRANSPORT_UNAVAILABLE";
			retryable: boolean;
	  }
	| { status: "closed" };
```

Methods remain on the handle, not in state. The handle defines
`getSnapshot()`, `subscribe()`, idempotent `connect()`/`disconnect()`/`close()`,
and a monotonic `replicaRevision` incremented for every text revision even when
status is unchanged. `close()` is terminal; reconnect requires a new handle.
`connect()` is explicitly client-only and StrictMode/ref-count safe.

`text.apply()` is allowed only in ready-edit or same-epoch offline-edit below
the local queue cap. View, idle, connecting, suspended, recovery-required, and
closed calls fail synchronously before local mutation. The origin replica may
show a speculative local change before server commit and marks it in
`pendingUpdates`. Durable-before-visible means no server ACK, remote broadcast,
projection, or server-authoritative replica mutation before commit. A rejected
speculative update is preserved as an opaque recovery artifact; it is never
silently rolled back, discarded, or uploaded under lost authority.

Read revocation emits no final document, roster, or awareness data. Edit
revocation fences writes first, then either closes or follows the explicit
fallback rule.

### CD-06 — CRDT engine and transport adapters

The kernel owns two private, independent seams:

- a document engine implementing the framework `text` replica semantics,
  update inspection, merge, state proof, snapshot materialization, and
  deterministic projection;
- a binary transport carrying kernel frames without interpreting CRDT bytes.

Yjs 13 is the first qualified engine in `@questpie/crdt-yjs`. It is never
present in application-facing `.d.ts` or root exports. Hocuspocus is not used.
QUESTPIE owns persistence and durable-before-visible ordering.

Server and client configuration are explicit generic ports:

```ts
runtimeConfig({
	crdt: {
		namespace: "acme-cms",
		engine: yjsServerEngine(),
		allowedOrigins: ["https://admin.example.com"],
		authenticateAgent: verifyAgentCredential,
	},
});

createClient<AppConfig>({
	crdt: {
		namespace: "acme-cms",
		path: "/crdt",
		engine: yjsClientEngine(),
	},
});
```

No CRDT fields leaves the runtime dormant. CRDT fields without a matching
server engine and attached host capability fail startup; a client without the
matching engine fails `connect()` with a typed error.

The first and only v1 qualified host is `@questpie/elysia` on the exact pinned
Bun runtime:

```ts
new Elysia().use(
	questpieElysia(app, {
		basePath: "/api",
		crdt: { path: "/crdt" },
	}),
);
```

The adapter registers same-origin ticket HTTP handling and a binary WebSocket
upgrade on the same app lifecycle, disables compression, and attaches the host
transport before app start. Hono and Next are explicitly unsupported in v1 and
must fail startup when CRDT fields are present without another qualified host;
there is no Autopilot sidecar. SSE, Channel publish, and fetch-stream snapshots
are not CRDT update transports.

`path` is relative to the client's normal API base path. The example therefore
mounts ticket issue at `/api/crdt/ticket` and WebSocket at
`/api/crdt/socket`; headless credentials use
`/api/crdt/agent-ticket`. Client/server namespace and host path must exactly match;
the ticket request carries the expected namespace and the server rejects a
mismatch without resource disclosure. After first authorization the client
persists locator→opaque binding/incarnation mapping with the offline queue. An
offline reopen therefore selects the old queue, and delete/recreate later yields
`owner_retired`/`epoch_changed` rather than attaching old updates to a new
owner. App URL or secret rotation does not change this key.

### CD-07 — Versioned binary protocol and hard limits

Protocol v1 uses this exact fixed 32-byte network-order header:

```ts
type CrdtFrameHeaderV1 = {
	magic: "QPCR"; // bytes 0..3
	major: 1; // u8 byte 4
	minor: 0; // u8 byte 5
	opcode: CrdtOpcodeV1; // u8 byte 6
	flags: 0; // u8 byte 7
	connectionSeq: bigint; // u64 bytes 8..15
	requestId: bigint; // u64 bytes 16..23
	payloadLength: number; // u32 bytes 24..27
	reserved: 0; // u32 bytes 28..31
};
```

The closed opcode union is:

| Direction | Opcode | Value | Legal state | Canonical payload |
| --- | --- | ---: | --- | --- |
| C→S | `AUTH` | `0x01` | unauthenticated only | `u16 ticketLength + base64url ticket ASCII` |
| C→S | `SYNC_PROOF` | `0x02` | authenticated/syncing | `u32 proofLength + opaque proof` |
| C→S | `SYNC_ACK` | `0x03` | syncing | `u32 chunkIndex + u64 throughSeq` |
| C→S | `UPDATE` | `0x04` | ready-edit/offline replay | `16-byte updateId + u64 epoch + u32 bytesLength + bytes` |
| C→S | `AWARENESS` | `0x05` | ready | `u32 bytesLength + RFC 8785 JSON UTF-8` |
| C→S | `HEARTBEAT` | `0x06` | authenticated | empty |
| C→S | `CLOSE` | `0x07` | authenticated | empty |
| C→S | `RECEIPT_QUERY` | `0x08` | syncing/ready | `u16 count + repeated(updateId[16] + SHA-256[32] + u64 epoch)` |
| S→C | `READY` | `0x81` | syncing→ready | `u8 mode + u64 epoch + u64 headSeq` |
| S→C | `SYNC_CHUNK` | `0x82` | syncing | `u32 chunkIndex + u64 throughSeq + u8 final + u32 bytesLength + bytes` |
| S→C | `UPDATE` | `0x83` | ready | `u64 epoch + u64 seq + u32 bytesLength + bytes` |
| S→C | `UPDATE_ACK` | `0x84` | ready | `16-byte updateId + u64 epoch + u64 seq` |
| S→C | `AWARENESS` | `0x85` | ready | `u32 bytesLength + RFC 8785 JSON UTF-8` |
| S→C | `EDIT_REVOKED` | `0x86` | ready-edit | `u8 fallbackDisposition` |
| S→C | `ERROR` | `0x87` | any accepted state | `u16 code + u8 retryable + u32 retryAfterMs + 16-byte correlationId` |
| S→C | `HEARTBEAT_ACK` | `0x88` | authenticated | `u64 serverTimeMs` |
| S→C | `AUTH_OK` | `0x89` | unauthenticated→authenticated | `u8 mode + u64 epoch` |
| S→C | `SUSPENDED` | `0x8a` | read-authorized | `u8 suspendedReason` |
| S→C | `RECEIPT_ACK` | `0x8b` | syncing/ready | `u16 count + repeated(updateId[16] + u64 epoch + u64 seq)` |

All integers are unsigned network order. UTF-8 must be shortest-form; fixed and
length-prefixed payloads allow no trailing bytes. One WebSocket binary message
contains exactly one complete QPCR frame. Text messages, concatenated frames,
or a partial frame at the message boundary reject; host-level WebSocket
fragmentation may reassemble only within the declared frame maximum. Only
schema-validated
awareness uses canonical JSON; authorization, identity, update, sync, and
control payloads never use an open map. `AUTH`, `SYNC_PROOF`, `UPDATE`,
`HEARTBEAT`, and `RECEIPT_QUERY` use a nonzero
unique `requestId`; their response/chunk sequence echoes it. Fire-and-forget
`SYNC_ACK`, `AWARENESS`, `CLOSE`, and unsolicited server frames use zero.
`connectionSeq` begins at one independently in each direction and is
exact-next; duplicate, gap, reorder, wrap, wrong-direction opcode, wrong-state
frame, request-id misuse, unknown major/minor/opcode/flag, and noncanonical
payload are protocol errors. No frame pipelines behind `AUTH` before
`AUTH_OK`; `AUTH_OK` echoes AUTH, every `SYNC_CHUNK` and final `READY` echo the
originating `SYNC_PROOF`, `UPDATE_ACK` echoes UPDATE, `HEARTBEAT_ACK` echoes
HEARTBEAT, and `RECEIPT_ACK` echoes RECEIPT_QUERY. A request-triggered `ERROR`
echoes that request; unsolicited `ERROR`/`SUSPENDED` uses zero. V1 has no
negotiation.

One connection carries one server-resolved document. Only `AUTH` is accepted
before ticket redemption. Later frames cannot carry document identity or
authority. WebSocket close mapping is fixed: normal `1000`, protocol `1002`,
authorization/policy `1008`, size `1009`, transient internal/transport `1011`.
Mode values are view `0` and edit `1`; fallback dispositions are close `0`,
view `1`, recovery `2`. Error values 1–6 map in order to the six public codes
in CD-15; `retryAfterMs=0` means absent. Suspended reasons 1–3 are canonical
conflict, document limit, and engine quarantine.

Normative minimal framing vectors below use connection sequence 1, request id 1
for correlated frames and zero otherwise. Empty IDs/proofs are parser vectors;
semantic validation may reject them after decoding.

- AUTH: `5150435201000100000000000000000100000000000000010000000300000000000141`
- SYNC_PROOF: `515043520100020000000000000000010000000000000001000000040000000000000000`
- SYNC_ACK: `5150435201000300000000000000000100000000000000000000000c00000000000000000000000000000000`
- UPDATE: `5150435201000400000000000000000100000000000000010000001c0000000000000000000000000000000000000000000000000000000100000000`
- AWARENESS C→S: `5150435201000500000000000000000100000000000000000000000600000000000000027b7d`
- HEARTBEAT: `5150435201000600000000000000000100000000000000010000000000000000`
- CLOSE: `5150435201000700000000000000000100000000000000000000000000000000`
- RECEIPT_QUERY: `51504352010008000000000000000001000000000000000100000002000000000000`
- READY: `51504352010081000000000000000001000000000000000100000011000000000000000000000000010000000000000000`
- SYNC_CHUNK: `51504352010082000000000000000001000000000000000100000011000000000000000000000000000000000100000000`
- UPDATE S→C: `51504352010083000000000000000001000000000000000000000014000000000000000000000001000000000000000100000000`
- UPDATE_ACK: `51504352010084000000000000000001000000000000000100000020000000000000000000000000000000000000000000000000000000010000000000000001`
- AWARENESS S→C: `5150435201008500000000000000000100000000000000000000000600000000000000027b7d`
- EDIT_REVOKED: `515043520100860000000000000000010000000000000000000000010000000000`
- ERROR: `51504352010087000000000000000001000000000000000100000017000000000001000000000000000000000000000000000000000000`
- HEARTBEAT_ACK: `51504352010088000000000000000001000000000000000100000008000000000000000000000000`
- AUTH_OK: `5150435201008900000000000000000100000000000000010000000900000000000000000000000001`
- SUSPENDED: `5150435201008a0000000000000000010000000000000000000000010000000001`
- RECEIPT_ACK: `5150435201008b000000000000000001000000000000000100000002000000000000`

Compression, including `permessage-deflate`, is disabled in v1. Length is
checked before allocation. Initial hard limits are:

| Boundary | Limit |
| --- | ---: |
| ticket request | 8 KiB |
| AUTH payload / ticket string | 512 B / 256 B |
| control/error payload | 8 KiB |
| awareness payload/profile | 1 KiB / 512 B |
| peer sync proof | 64 KiB |
| receipt query | 64 entries |
| one update or sync chunk | 256 KiB |
| canonical UTF-8 text | 16 MiB |
| encoded engine snapshot | 24 MiB |
| total initial sync | 32 MiB |
| inbound staged queue per session | 32 frames and 1 MiB |
| outbound document queue per session | 256 frames and 4 MiB |

Document updates are ordered, non-coalescing, and never dropped. A slow
consumer is closed and resynchronizes. Awareness is the only latest-wins class.
All queues are bounded by both count and bytes. Initial sync uses a pull/ACK
window at most 4 MiB; it never queues the full state. `READY` is legal only
after basis chunks and a pre-ready durable drain watermark are acknowledged.
The 64 KiB Yjs state vector is worker-validated and optimization-only: it is
never authority, epoch/fence, GC input, or proof that the peer is caught up.
Invalid/missing proof receives verified full state.

### CD-08 — Tickets and admission

Ticket issue first applies bounded IP/credential pre-admission, then
authenticates, applies the browser/headless Origin rules in CD-04, rejects
`system`/anonymous, resolves the typed field identity, evaluates authority, and
reserves global admission before returning a 30-second one-use ticket with at
least 256 bits of secret entropy.

The database stores only a public random id plus keyed secret hash, internal
document reference, subject/credential fingerprint, audience/origin, requested
and granted mode, protocol/adapter versions, epoch/fences, expiry, and
redemption time. The ticket is sent only in the first binary AUTH frame, never
in a URL. Redemption is one atomic conditional update; concurrent redemption
has exactly one winner. A redeemed ticket creates a durable session grant and
is never itself continuing authority.

Defaults:

- five active sessions per authority subject across all instances;
- 100 sessions per document across all instances;
- 60 updates/second/session, burst 120;
- 1 MiB update bytes/second/session, burst 2 MiB;
- 1,000 updates/second/document, burst 2,000;
- 20 awareness updates/second/session;
- 10 ticket issues/minute/credential and 30/minute/subject;
- five-second unauthenticated deadline and one unauthenticated frame;
- 256 unauthenticated upgrade sockets per instance and five per trusted
  proxy-resolved client IP.

Hard global caps use durable subject and document admission-head rows. Ticket
issue locks both in canonical order, counts DB-time-active sessions plus
unexpired reservations, and inserts one reservation atomically. Redemption
converts that reservation to a leased session without double counting.
Expiry/release is query-correct before cleanup; cleanup only reclaims rows.
Exact document/session rate buckets update under the existing document/session
locks. The process-local `RealtimeAdmissionRegistry` is not reused.
Collaboration uses bounded `tryAcquire` semaphores and a separate cap on
unauthenticated sockets; it never uses an unbounded pending array.

Untrusted engine work runs in a bounded, terminable worker pool with one
process-local optimization lane per document, 2×CPU active workers, at most 64
pending jobs and 128 active materialized documents, a 100 ms update budget, and
two-second initial materialization budget. Qualification must demonstrate a
hard 64 MiB per-job RSS/ArrayBuffer ceiling or terminate the isolated worker at
the first enforceable host limit with bounded measured overshoot. `Promise.race`
is not a CPU or memory limit.

### CD-09 — Durable namespace

CLI-generated migrations create framework-owned tables:

- `questpie_crdt_namespace`: verified immutable application namespace;
- `questpie_crdt_resource`: owner kind/key/locator, exactly one current
  incarnation shared by all its CRDT field bindings, historical retired rows;
- `questpie_crdt_binding`: owner key/id, immutable resource incarnation, field
  path, identity version, active/retired state, unique current binding;
- `questpie_crdt_document`: internal id, definition/identity versions,
  owner/field identity, engine/protocol/state-format versions, status, epoch,
  separate read/edit room fences, head sequence, canonical hash/revision,
  projected epoch/sequence, current/previous snapshot pointers, byte budgets;
- `questpie_crdt_update`: `(document, epoch, seq)`, immutable `bytea`, exact
  length, SHA-256, client update id/hash, attributed subject/session hashes;
- `questpie_crdt_update_receipt`: idempotency receipts retained for the entire
  supported offline horizon, independent of update compaction;
- `questpie_crdt_snapshot`: immutable verified engine snapshot with
  `(document, epoch, coversSeq)`, versions, size, checksum;
- `questpie_crdt_ticket`, `questpie_crdt_session`,
  `questpie_crdt_subject_fence`;
- `questpie_crdt_subject_admission`, `questpie_crdt_document_admission`;
- `questpie_crdt_awareness`: current expiring session state only;
- `questpie_crdt_projection`: idempotent projection work/status and expected
  canonical revision;
- `questpie_crdt_lease`: fenced compaction/migration/projector lease.

Sequences and epochs are PostgreSQL bigint and cross TypeScript/wire boundaries
as exact bigint/string values, never unsafe JavaScript numbers. DB time owns
leases. Resolved identity is bounded, framework-private, versioned, and excluded
from logs/metrics. Deletion/retirement is explicit; history is not casually
cascade-deleted.

Required invariants include primary key `(document, epoch, seq)`, unique
idempotency receipt `(document, epoch, updateId)` with stored hash, one active
binding per namespace/owner-incarnation/field, nonnegative sequence/byte checks,
bounded key/path lengths, lease/session/reservation expiry indexes, and no
cascade capable of deleting the only recovery basis.

### CD-10 — Atomic append and revocation ordering

Qualified Yjs text updates are commutative and idempotent, but safety limits are
state-dependent. The engine stages each candidate against a verified
`(epoch, baseSeq=N)` replica in the isolated worker. It validates exactly one
named Y.Text root, decoded struct/delete/pending-dependency counts, well-formed
text, scalar-boundary operations, resulting UTF-8 text bytes, encoded snapshot
bytes, and worker cost. Extra maps/arrays/XML/subdocuments/roots are rejected.
The staged immutable token contains epoch, base sequence, engine/state version,
update digest, cost, resulting bounds, and canonical update bytes.

Append:

1. Validate frame, immutable bytes, digest, rate, session, and worker admission.
2. Rebuild principal/context and evaluate read/edit outside any document lock;
   capture subject, decision expiry, and observed durable fences.
3. Stage against the current verified `(epoch, baseSeq)` in the bounded worker.
4. Begin a transaction and lock the document header first.
5. Run no application callback. Re-read status, epoch, separate read/edit room
   fences, subject fence, session generation/mode/lease, decision expiry,
   adapter version, and require `headSeq === baseSeq`.
6. Resolve idempotency: same update id/hash returns its original receipt;
   same id/different hash is a protocol violation.
7. Allocate `seq = head + 1`, insert update/receipt, advance head and budgets.
8. Commit.
9. Publish a metadata-only wake; durable drain applies to local replicas,
   broadcasts, and acknowledges `{ epoch, seq, updateId }`.

If the basis is stale, discard it and restage with a bounded retry budget; a
process lane is only an optimization and the DB head comparison is the HA
serialization. Append and every fence mutation lock the same document row.
That lock is the durable authority linearization point: an append whose lock
wins may commit before revocation; no append commits after the revocation
transaction. Read revoke advances read and edit fences; edit revoke advances
only edit.

Nothing mutates a server-authoritative replica, acknowledges, remotely
broadcasts, wakes, or projects before commit. The speculative origin behavior
is defined by CD-05.

If local apply fails after commit, the document is rebuilt from durable state;
deterministic repeated failure quarantines it. Lost acknowledgements retry
idempotently. Rollback creates no update, receipt, wake, or head advance.

Lost-ACK reconciliation does not require current edit authority. During
read-authorized sync/view, `RECEIPT_QUERY` accepts at most 64
`(updateId, SHA-256, epoch)` tuples and returns only matching durable receipts
for the same current document, authority subject, epoch, and hash. It never
creates an update. Missing/wrong subject/hash/document/epoch is indistinguishable
from absent. Read revocation returns no receipt information. This lets a client
clear already-durable pending work and safely enter explicit viewer fallback
after edit revocation.

### CD-11 — Gap-free bootstrap, HA wake, and reconciliation

Open/reconnect:

1. Freshly resolve field and authority; create a syncing session bound to the
   current epoch/fences.
2. In one repeatable-read basis, read header `(epoch, head=N, snapshot=S)`,
   verified S, and tail `(S.coversSeq, N]`.
3. Materialize the text replica in the bounded worker.
4. Register the local durable drain cursor at N before the final basis chunk.
5. Send basis through the bounded ACK window.
6. Repeatedly read head, drain `>cursor`, and require an acknowledged stable
   cut before reporting ready. A commit racing any chunk/ACK/register/drain
   boundary is included by the loop or a later wake.

Wakes are latency hints only. App core owns one multicast notice router,
starting it before Realtime/CRDT subscribers and stopping it after both
unsubscribe. RealtimeService no longer owns the physical broker lifecycle.
Subscriber queues are isolated and bounded so a failing/slow CRDT subscriber
cannot delay realtime. The router multiplexes normalized `realtime` and `crdt`
kinds; every instance with local sessions drains on wake, immediately after
broker reconnect, every 2 seconds when healthy, and every 250 ms while a local
document is known behind. Drop, duplicate, reorder, and loss cannot change
correctness. Broker payloads contain only bounded kind, opaque document hash,
epoch/head/fence generation; never CRDT bytes or application identity.

Rolling rollout enables CRDT only after every replica recognizes the new
normalized wake kind. Graceful stop order is: stop ticket/frame admission;
reject new worker jobs; bounded-wait in-flight inspection/append under DB
statement deadlines; stop drains; close sessions/awareness; best-effort lease
cleanup; stop host transport; unsubscribe router. The physical router stops
last at app shutdown. A committed update with lost shutdown ACK remains
idempotently retryable; no callback may create a broker listener/client after
stop.

CRDT head sequence is per document/epoch and is never realtime txid, outbox
sequence, or Channel event id.

### CD-12 — Snapshots, compaction, retention, and projection

Compaction uses a fenced lease:

1. Capture a verified same-epoch base and tail through N.
2. Materialize and validate outside the document lock.
3. Write an immutable checksummed snapshot and read-verify it.
4. CAS-publish the pointer for the same epoch/lease generation.
5. Only after pointer commit, run bounded GC.

Crashes before pointer leave an orphan; crashes after pointer leave a safe
leak. Keep the current and previous verified snapshots plus every update after
the previous snapshot cursor. Before a previous snapshot exists, retain every
current-epoch update. Corrupt current state rebuilds from previous plus retained
tail before quarantine. Session acknowledgements are never GC authority.
Retain idempotency receipts and old epochs for a default 30-day offline/recovery
horizon. Recovery holds are bounded and expiring.

Initial compaction triggers are 512 updates or 4 MiB since the current snapshot,
but every candidate append already enforces materialized limits at its staged
basis. A verified materialized text document at the hard limit rejects the
crossing update before commit and becomes `write_suspended` only for corruption
or pre-existing oversize state; view/export remain possible.

Projection is asynchronous operational work:

- projects a verified snapshot/cursor to the canonical text field;
- uses expected canonical revision and idempotency key;
- records projected sequence separately from CRDT head;
- uses the non-starving five-second due time from CD-03; session close only
  accelerates it;
- failure never deletes CRDT state;
- CAS conflict suspends writes rather than applying last-write-wins.

### CD-13 — Epochs, offline work, and recovery

Each local update receives a persistent random id before entering a bounded
offline queue. Queue keys include credential subject, application, document,
and epoch. Queue limits freeze further editing; they never evict silently.
An update is removed only after its matching durable acknowledgement.

Same-epoch reconnect within the 30-day horizon first synchronizes server state,
then replays local updates idempotently. Queue age beyond the horizon requires
recovery/export even if the epoch is unchanged. Epoch change never auto-uploads
old bytes; it enters
`recovery-required` and preserves an opaque export artifact for explicit
application recovery. Logout/account change purges or explicitly exports that
credential's queue; one user cannot observe another user's pending work.

Replace, restore, incompatible engine/state-format migration, and destructive
reset all follow owner-row→sorted-document-row locking, advance read/edit
fences, stop writes/sessions, atomically install a verified new epoch/canonical
basis, and reject every old-epoch update. Migration is a fenced online workflow
with durable stages and rollback basis, not DDL and never an empty fallback.

### CD-14 — Roster and awareness

Roster comes from durable, lease-backed server sessions. Identity, subject
grouping, and granted mode are server-derived. Tabs/devices are separate
sessions and may be grouped only in the projection.

Awareness is optional, schema-validated, session-scoped, ephemeral,
latest-wins, and read-authorized in both directions. It is never an update,
snapshot, projection, checkpoint, audit event, or diagnostic payload. Defaults
are 1 KiB, 20 writes/second, 10-second heartbeat, and 30-second expiry.

The generic text format accepts UTF-16 scalar-boundary offsets within the
sender's current replica. The Yjs engine translates them to private relative
positions for transport and back to current local offsets for receivers; no Yjs
bytes enter the public awareness schema. They remain ephemeral hints, not
durable anchors. Durable anchors/comments are a separate future capability and
are not smuggled into this primitive.

### CD-15 — Safe errors and observability

Public codes are closed and disclosure-safe:

- `CRDT_UNAVAILABLE`;
- `CRDT_EDIT_NOT_ALLOWED`;
- `CRDT_RATE_LIMITED`;
- `CRDT_PROTOCOL_REJECTED`;
- `CRDT_RECOVERY_REQUIRED`;
- `CRDT_TRANSPORT_UNAVAILABLE`.

Unknown field/record, resolver null, read denial, and invalid/expired/used/
wrong-origin/wrong-principal ticket are externally indistinguishable as
`CRDT_UNAVAILABLE`. More detail is available only after read authority.
Responses contain stable code, retryability, optional bounded retry-after, and
opaque correlation id. Provider, SQL, policy, and adapter exception text never
reaches clients.

Metrics use bounded enums and numeric measurements only: phase, outcome,
engine/transport registry id, mode, frame/size/duration bucket, queue depth,
sync/projection lag, lease conflict, and close reason. Never log or label
document/resource/record ids or hashes, ticket/credential/update ids,
principal/profile/awareness, sync proofs, snapshots, updates, canonical text,
or authorization error messages. Observer failure is non-fatal.

### CD-16 — Packaging, codegen, runtime, and migrations

Minimal package placement:

- generic builder, kernel, generated server/client types, protocol, and host
  transport contracts live in existing `questpie` under `questpie/crdt`;
- one new `@questpie/crdt-yjs` package contains only qualified `/server` and
  `/client` engine implementations and no UI bindings;
- no collaboration UI, Tiptap, Hocuspocus, Markdown, or provider package.

`.crdt()` is a core `Field` capability method, not the current plugin
field-extension mechanism (whose `set()` erases marker types). It returns a
type-state marker such as
`Field<TState & { crdt: CrdtTextCapability<TAwareness> }>` and stores normalized
runtime metadata in field state. Every existing builder refinement must preserve
that marker when the resulting field remains eligible, regardless of call
order; ineligible refinements are rejected in either order. Collection/global
runtime field maps are the registry; codegen only derives typed CRDT projections
from the marker.
There is no discovered category, plugin module, or duplicate registry.

Runtime `crdt.namespace`/server engine use ordinary runtime config; the client
engine uses `createClient` config; Elysia attaches the concrete host capability.
New public subpaths originate in `src/exports` and tsdown entries; package
exports are never hand-edited. `@questpie/crdt-yjs` has no root export, only
`/server` and `/client`, peers on generic `questpie`, and joins the fixed version
group for the coherent 3.x release.

Yjs versions are rechecked and pinned to a qualified Yjs 13 release.
PostgreSQL 15+ reuses the version preflight already implemented at
`db/postgres-version.ts`; no CRDT-specific duplicate is added. The primitive
does not raise the current Node floor merely for an unused provider; generic
packages pass the supported Node matrix and the concrete Elysia host passes
exact pinned Bun 1.3.13. All DDL is CLI-generated. Run migration generation
twice and require the second run to produce no diff.

The existing full-snapshot realtime path remains additive and unchanged.
Broker adapters, HA topology contracts, and poll-reconcile guarantees are not
replaced.

### CD-17 — TDD and verification contract

Implementation uses vertical tracer bullets. Every bullet starts with one
public behavior test, fails for the expected reason, receives the minimum
implementation, passes, and is refactored only while green.

Required suites:

1. field eligibility/type-marker call-order matrix, runtime registry, deterministic
   collection/global codegen, phantom/non-CRDT key rejection, and `.d.ts`;
2. create rollback/seed, existing/global activation-vs-CRUD race, every ordinary
   mutation-path reject, unrelated CRUD, delete-vs-append/project,
   soft-delete/ordinary-undelete reject, restore same incarnation/new epoch,
   hard-delete/recreate new incarnation, namespace mismatch and rename mapping;
3. Human/OAuth-Human/verified-Agent/system isolation, mandatory scopes,
   row/AccessWhere, patch-dependent fail-closed edit, browser Origin
   canonicalization/missing/null/spoof cases, cookie-free Agent flow, fresh
   context;
4. binary golden vectors on Node/Bun plus fuzzing of major/minor/opcode,
   direction/state, flags, lengths, sequence/request id, trailing bytes,
   fragmentation, and compression rejection;
5. 100-way ticket redemption with one winner, indistinguishable failures,
   custom base/path, client namespace mismatch and offline locator binding;
6. viewer update rejection; ACL/document deadlock oracle; revoke-vs-append in
   both orders; sorted multi-document revoke; read revoke during sync; no
   post-fence commit; commit→lost ACK→edit revoke→read-authorized receipt
   reconciliation, with wrong subject/hash/document/epoch and read-revoke
   nondisclosure;
7. 50+ real PostgreSQL contending appends proving cursor/commit ordering,
   rollback, idempotent ack retry, and bigint safety;
8. flow-controlled 4/16/32 MiB sync and commit injection at every
   chunk/ACK/register/drain boundary proving no gap or queue overflow;
9. router characterization/extraction, one physical lifecycle, subscriber
   isolation, dropped/duplicated/reordered wakes, reconnect drain, two nodes;
10. Yjs golden convergence, atomic op-list, emoji/ZWJ/combining/RTL, invalid
    scalar boundary/NUL/surrogate, one-root enforcement, offline reload, and
    deterministic text projection;
11. stale-basis retry, two-node combined boundary crossing, struct/delete/
    missing-dependency bombs, CPU/RSS/ArrayBuffer attacks in the worker;
12. bounded admission, every queue limit, slow consumer, reconnect recovery;
13. compaction crash matrix, corrupt-current fallback, receipt preservation,
    zero-session GC, and old-epoch recovery horizon;
14. same-epoch N/M projector inversion, old-projector→replace→late stale no-op,
    exact five-second non-starvation, unrelated owner update, raw-field hash
    conflict, replace crash atomicity, exactly one realtime origin, no
    hooks/version recursion or LWW overwrite;
15. multi-tab/device grouping, awareness spoof/rate/expiry/no durable leakage;
16. SSR produces zero socket/ticket/worker/IndexedDB side effects; hydration,
    StrictMode, route cleanup, and cross-account offline isolation;
17. Elysia/Bun real upgrade, same-origin/headless ticket, proxy timeout and
    two-node no-affinity; shutdown with blocked worker/transport and in-flight
    transaction is bounded and creates no post-stop listener/client;
18. public bundle and `.d.ts` contain no Yjs/provider/UI types;
19. CLI migration snapshots and second generation no-diff;
20. real PostgreSQL 15+ fresh/upgrade/namespace isolation, supported Node, exact
    Bun, package build/typecheck/test/lint/format and isolated `npm pack` import
    smoke for every new subpath.

Negative oracles:

- no CRDT bytes in Channels, realtime snapshots, ChangeBroker, logs, metrics, or
  canonical CRUD requests;
- no system/anonymous editor and no Human credential lent to an Agent;
- no server-authoritative apply/ack/remote broadcast/projection before durable
  commit; speculative origin state is always marked pending;
- no stale epoch/fence/session update;
- no client identity controls admission, participant identity, or room;
- no unbounded queue or `Promise.race` CPU limit;
- no dropped durable update for a slow client;
- no GC removes the only verified recovery basis or idempotency receipt;
- no missing broker wake changes correctness;
- no direct CRUD/LWW mutation of an active CRDT field;
- no socket/ticket/worker/offline store during SSR;
- no Yjs, editor, provider, or consumer-domain type in generic public API.

### CD-18 — Docs, recipes, skills, and release

The single consolidated PR includes:

- `concepts/crdt-fields`, `server/fields/crdt`, `client/crdt`,
  `production/crdt-host-support`, and `guides/collaborative-text`, with every
  containing `meta.json` updated;
- architecture coverage for field ownership, canonical projection, and reuse
  boundaries plus exact generated client/server API reference;
- authorization/revocation guide for authentication principals and Human/Agent
  authority actors;
- offline/recovery, compaction/retention, observability, security, production
  host/runtime support, and troubleshooting docs;
- a generic recipe using headless collection and global clients, demonstrating
  CRUD rejection, explicit replace, offline epoch recovery, and no editor;
- an executable multi-client fixture used by acceptance tests;
- QUESTPIE skill reference `references/crdt.md`, routing updates, and relevant
  codegen/infrastructure references.

Skill sources are edited and generated AGENTS documentation is rebuilt with the
repository script; generated AGENTS files are never hand-edited. New public
exports/packages are added to skill coverage and install verification.

Release remains one consolidated PR and one coherent QUESTPIE 3.x minor line as
already ratified for this repository. The additive actor seam deliberately
avoids expanding `Principal.kind`; a previous-version exhaustive-switch compile
fixture is the semver oracle. One consolidated CRDT changeset bumps `questpie`,
`@questpie/elysia`, and the fixed-group `@questpie/crdt-yjs` surface without
manufacturing a 4.0.0 release. Before stable release:

1. finish TDD and adversarial self-review;
2. generate migrations twice with no second diff;
3. pass package and real-runtime matrices;
4. pack and smoke every public export;
5. publish a canary and run the isolated generic fixture;
6. publish QUESTPIE upstream;
7. only then update Autopilot to the exact released minimum version and run its
   consumer acceptance suite.

No committed consumer workspace link, Autopilot-local backend, tables,
protocol, or compatibility shim is permitted.

## Walking skeleton

1. Two authenticated clients open the same CRDT-enabled collection field.
2. Both receive one verified text state and roster.
3. They edit concurrently at the same and different offsets.
4. Origin-local speculative edits are marked pending; server-authoritative
   apply, remote visibility, and ACK follow authorized durable commit.
5. One client goes offline, reloads, edits, reconnects, and converges.
6. A headless Agent opens and edits under its own credential.
7. Edit revocation prevents the next durable update; read revocation stops all
   sync and awareness.
8. A stale session and old epoch cannot commit.
9. Projection updates the normal canonical field with CAS protection.
10. Compaction and restart preserve convergence and offline idempotency.

## Consolidated implementation graph

The Agent Board graph mirrors these dependency edges:

- **T0 Contract and adversarial closure** — ratify this document, state machine,
  protocol, limits, scenarios, and negative oracles.
- **T1a Baseline characterization** — one broker lifecycle, current realtime
  reconnect/shutdown, access/field type preservation, PG15 preflight; depends
  on T0.
- **T1b Shared infrastructure** — multicast router, bounded queues/semaphore,
  fresh-context plus additive actor seam; depends on T1a.
- **T2a Field type-state/eligibility** — core marker and compile/runtime matrix;
  depends on T0.
- **T2b Registry/codegen/identity guards** — marker-derived registry, generated
  collection/global API, stable identity derivation, and ordinary CRUD guards;
  depends on T2a.
- **T3a Protocol/host contract** — pure wire parser/golden vectors and Elysia
  mount contract; depends on T0.
- **T4a Generated durable schema/stores** — binding, document, snapshot, update,
  receipt, ticket, session, admission, projection, leases; depends on T2b.
- **T5a Generic engine seam/fake** — UTF-16 text operations, staged basis and
  deterministic fake; depends on T2a.
- **T5b Qualified Yjs engine** — server/client package, worker bounds,
  convergence; depends on T5a.
- **T2c Persisted owner lifecycle** — singleton namespace verification,
  resource/incarnation/binding create and lazy activation, add-field,
  delete/restore/recreate; depends on T2b, T4a, and T5a.
- **T3b Ticket/admission/host** — issue, redemption, global caps and real Elysia
  upgrade; depends on T1b, T2c, T3a, T4a.
- **T4b Atomic append/fencing** — staged head CAS, receipt, commit-order cursor,
  post-commit wake; depends on T1b, T2c, T4a, T5a, then qualifies with T5b.
- **T6 Sync/HA** — flow-controlled bootstrap, router drain, polling, reconnect;
  depends on T1b, T3b, T4b, T5b.
- **T8 Projection/compaction/replace** — owner lifecycle, CAS projector,
  snapshots, retention, GC and epoch; depends on T2c, T4b, T5b and integrates
  with T6.
- **T7 Client/offline/awareness** — inert handle, SSR, offline recovery,
  roster/awareness; depends on T2b, T3a, T5b, T6, T8.
- **T9 End-to-end/chaos** — two-node real PG, Bun/Node, failure matrix,
  shutdown, previous-version compile and public leak audit; depends on T1–T8.
- **T10 Docs/recipe/skills** — executable recipe, docs, skill coverage and
  regenerated artifacts; final gate depends on T9.
- **T11 Release consolidation** — changeset, pack/canary, PR gates, stable
  upstream release, exact consumer bump; depends on T9 and T10.

## Evidence

- `../realtime/TRANSPORT.md`
- `../../../../channels/channel-builder.ts`
- `../../../../channels/service.ts`
- `../../../../../client/channels/types.ts`
- `../../../../../client/channels/index.ts`
- `../../../../../../../tanstack-query/src/channel-query-options.test.ts`
- `packages/questpie/src/server/config/context.ts`
- Autopilot source contracts listed in the initiating brief
