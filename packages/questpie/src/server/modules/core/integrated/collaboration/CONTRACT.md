# QUESTPIE collaborative aggregate contract

Status: ratified on 2026-07-25.

This is the normative framework contract for CRDT-backed collection records and
globals. Agent Board records delivery evidence; it does not define a second
architecture.

## Scope

Collaboration is an owner-aggregate capability:

- one collection record or one global is one collaborative aggregate;
- explicitly marked fields are independent typed replicas inside that
  aggregate;
- the aggregate shares resource identity, authorization, lifecycle, schema,
  session, commit order and atomic multi-field transactions;
- fields retain independent engines, epochs, cursors, grants and fences.

It is not a whole collection table, a field-only public document, an editor
integration or one opaque shared root. QUESTPIE contains no Tiptap,
ProseMirror, React or other UI dependency. Yjs is a private text-engine
implementation behind `@questpie/crdt-yjs`, not the public model.

The acceptance tracer is one `articles` record where different participants
edit title text, add or remove tags and edit body text concurrently. A caller
may update all three in one atomic collaborative transaction.

## Declaration and generated API

An owner must opt in with `.collaborative()`. Eligible fields opt in with a
`.crdt(...)` strategy. Codegen derives the typed owner and field registry and
exposes:

```ts
const article = client.crdt.collections.articles.document({ id: "article-1" });
const settings = client.crdt.globals.siteSettings.document();

await article.connect({ mode: "edit", fallback: "view" });

article.transaction(({ fields }) => {
	fields.title.text.apply([{ type: "insert", index: 0, value: "Shared" }]);
	fields.tags.set.add("news");
	fields.content.text.apply([{ type: "insert", index: 0, value: "Body" }]);
});
```

V1 qualifies:

- unbounded, required, non-localized text with identity encoding and no
  transform/refinement/hook that can invalidate an independently valid merge;
- a required string array with `format: "set", conflict: "add-wins"` under the
  same identity/no-refinement restrictions.

The set is an observed-remove add-wins set. Values are unique strings ordered
by unsigned UTF-8 bytes. Text indices use UTF-16 code units at scalar
boundaries. U+0000, unpaired surrogates, invalid operations and invalid
aggregate parts reject atomically.

Localized, virtual, nullable, bounded-varchar, relation, upload, ordered-list,
object/map and custom-codec fields are unsupported until separately qualified.

## Durable identity and lifecycle

Generated manifests own stable UUID identities for definitions, schemas and
fields. A generated manifest is append-only and must be no-diff on a second
generation pass. Hand-edited identity or incompatible removal fails closed.

One live owner incarnation has one active resource epoch. Soft delete retires
the active epoch; restore starts a new epoch for the same incarnation. Physical
delete followed by recreation creates a new incarnation. Schema transitions,
field resets, replaces, suspension recovery and retirement are durable control
commits.

Ordinary CRUD cannot change CRDT-managed fields, including system-mode, bulk,
batch, version restore or hooks. Canonical projection is framework-owned and
runs in the same managed database transaction as its outbox effects.

## Authority

Every open and exchange decision builds fresh request authority. The framework
preserves three actor kinds:

- cookie-authenticated User;
- OAuth-Human with a stable token id and normal collection/global scopes;
- verified Agent through the explicit `authenticateAgent` seam.

Cookie requests require an exact configured HTTP(S) Origin. Cookie plus bearer
credentials reject before either authenticator runs. Agent edit requires
`crdt:edit`. Owner and field access reuse normal QUESTPIE policy evaluation
against the complete canonical owner record; hidden policy inputs never become
client grants.

The durable authority cut includes subject and credential identity, audience,
origin, resource incarnation and epoch, schema, requested/effective mode,
resource/subject/field fences, policy revision, session generation, authority
expiry, complete binding cut and readable grants. A visible binding id grants
notification delivery only, never read or write authority.

Unknown, denied, retired, cross-tenant, cross-credential and stale requests use
one disclosure-safe unavailable/recovery contract.

## One realtime connection, HTTP data plane

`createClient()` owns one lazy internal realtime session. Live queries,
framework Channels, CRDT visible-dirty hints and awareness-dirty hints share:

- one SSE stream; or
- one `pusher-js` connection with multiple subscriptions.

The existing broker adapters, HA topology ownership, fencing and poll
reconciliation remain the physical control plane. CRDT wakes are opaque,
coalescable hints. They never contain updates, owner locators, fields, cursors,
grants or credentials. Correctness does not depend on delivery of a hint.

CRDT bytes use the normal Fetch handler:

```text
POST /realtime/crdt/open
POST /realtime/crdt/exchange
```

There is no adapter-specific CRDT host, extra server, extra process, dedicated
worker, socket upgrade, public custom transport or second provider connection.
The same routes work wherever `createFetchHandler` works, including TanStack
Start/Nitro, Hono, Next and Elysia.

## Atomic idempotent open

Open accepts bounded JSON containing a random 128-bit `openId`, owner locator,
requested mode/fallback and the current internal realtime edge-session proof.

It:

1. rejects compression and bounded-reads the body;
2. authenticates and authorizes without existence disclosure;
3. validates the exact live edge owner generation;
4. locks admission rows;
5. creates one durable session and its readable grants atomically;
6. returns only non-secret client state: binding id, deployment/namespace,
   offline subject key, manifest and initial pull descriptor.

Repeating the same `openId` after response loss returns the same logical
session, consumes no additional rate token or capacity and may reattach the
binding to a newer edge owner generation. A stale generation cannot roll the
delivery fence back.

New opens use durable database-time buckets:

- subject: burst 30, one token every two seconds;
- credential: burst 10, one token every six seconds.

Global, subject, credential, resource and edge-document capacity limits are
transactional.

## QPCX/1.0 exchange

The exchange endpoint uses one closed binary request/response union:

| Request          | Response                    |
| ---------------- | --------------------------- |
| pull             | frozen pull page            |
| append           | durable append receipt      |
| receipt query    | matching durable receipts   |
| awareness action | authorized roster page data |
| heartbeat        | database server time        |
| close            | empty acknowledgement       |

Authorized busy and disclosure-safe recovery are the only additional response
variants.

The fixed 32-byte network-order header carries `QPCX`, major/minor, opcode,
zero flags, a nonzero 128-bit request id, exact payload length and zero
reserved bytes. Requests and responses have disjoint opcodes. Unknown
versions/opcodes, invalid direction, compression, truncation, trailing bytes,
noncanonical JSON/UTF-8, unsorted or duplicate fields/receipts and invalid
numeric ranges reject before mutation.

Normative limits:

- 256 KiB per field update or pull chunk;
- 32 sorted unique field parts;
- 1 MiB encoded payload plus the fixed header;
- 64 KiB proof per field;
- 1 KiB awareness input;
- 64 receipt queries;
- BUSY retry delay from 1 through 5,000 ms;
- 64 MiB total bootstrap artifact.

Every exchange may run on any API node. It re-authenticates, matches the
durable subject/credential and both session generations, refreshes authority
and validates the relevant fences. Mutable content heads are operation-owned:
generic authority validation does not falsely invalidate a session merely
because collaborative content advanced.

Append ACK follows the durable commit and receipt transaction. Repeating an
`updateId` with the same submitted hash returns the original receipt;
conflicting reuse rejects. Any unauthorized or invalid part rejects the entire
multi-field append. Heartbeat cannot resurrect an expired/fenced session.
Close is idempotent.

## Frozen visible-cut pull

Pull atomically freezes the receiver's readable field vector and grant
fingerprint. It does not expose the aggregate head or hidden-field progress.

Materialization writes immutable, checksummed pages under a durable pull row.
Continuation is opaque, HMAC-authenticated, deployment-bound, retryable on any
node and bound to session generations, subject/credential, incarnation/epochs,
schema/fences, grant fingerprint, artifact offset and expiry.

The client reconstructs shadow replicas and publishes them only after all
lengths, offsets, per-field digests and the whole artifact digest verify.
Continuation pages cannot include fresh client proofs. A non-final page must
make byte progress.

Hidden-only advancement changes no receiver-visible field vector, payload or
artifact digest. A concurrent commit after reservation cannot rewrite the
frozen artifact; it is observed by a later pull.

One active pull lease per binding and bounded per-binding/subject/instance
budgets prevent bootstrap amplification. A dirty hint during a pull schedules
at most one fair follow-up.

## Awareness and presence

Awareness is ephemeral, schema-validated and separately rate-limited. The
client writes at most one latest value per 50 ms. The database stores it under
the session/authority TTL and assigns a server-owned participant identity.

Realtime sends only an awareness-dirty hint. The client retrieves an
authorized, bounded, paginated roster through QPCX. Roster projection:

- groups multiple sessions of one subject;
- omits sessions with stale resource, subject or field fences;
- drops the participant when no shared readable grant remains;
- removes expired awareness without requiring a final client message;
- caps each page by its encoded size.

Provider-native presence is not CRDT identity or authority.

## Offline client

Construction and SSR are inert. IndexedDB is opened only when a document
connects. Durable client state is partitioned by server-issued deployment,
namespace, owner incarnation and offline subject key.

Reconnect first reconciles receipts, then serially replays remaining pending
bundles. Partition and field-basis writes use monotonic compare-and-swap.
Subject changes, epoch changes, purged generations, field downgrade, corrupted
hashes, expired retention or queue overflow freeze pending bytes into an
explicit recovery state; they never silently replay under new authority.

Disconnect or authority invalidation revokes the local lifecycle so late open,
pull, storage or realtime callbacks cannot publish ready/editable state.

## Durable text anchors

Every generated text field exposes an opaque durable-anchor port:

```ts
const anchor = article.fields.content.anchors.create({
	kind: "range",
	start: 12,
	end: 28,
});
const resolution = article.fields.content.anchors.resolve(anchor);
```

Points default to following affinity. Ranges default inward: the start follows
insertions at its boundary and the end precedes them. Inputs use UTF-16 code
unit offsets at scalar boundaries; ranges must be nonempty and ordered.

The client may create an anchor from a readable view or edit grant only after
the field basis is acknowledged. Creation rejects while that field is syncing,
has a pending update, or participates in an active local transaction. Resolve
uses the currently readable replica. The request-scoped server API exposes the
same field port asynchronously; create and resolve each rebuild fresh read
authority and load the authoritative field head.

The branded string is bounded to 2,048 characters and wraps bounded
engine-relative positions. It binds the server namespace, owner incarnation,
field slot, field epoch, engine id and format version. It is not an authority
capability and must never be parsed or manufactured by application code.
Malformed, foreign, stale and unresolvable tokens all return the same
`{ status: "detached" }` result after read authority succeeds.

Ordinary CRDT edits and snapshot compaction preserve anchors. Replacement,
import, restore, incompatible schema transition, physical purge and
delete-then-recreate establish a new bound identity and detach old anchors.
An application that stores review comments or annotations owns their quote,
excerpt and fallback policy; QUESTPIE owns only the durable structural
position.

## Projection, compaction and operations

Collaborative commits, receipts, field cursors, snapshots, recovery holds,
pulls, sessions, grants and awareness live in framework-owned PostgreSQL
tables. Foreign keys use fail-closed restrict semantics; durable recovery and
idempotency rows are never cascade-deleted.

Projection and compaction are bounded app-owned operational work driven by
lossy wakes plus periodic reconciliation. They run inside the existing API or
configured QUESTPIE worker runtime; enabling CRDT does not start another
process. Shutdown aborts and bounds the in-process coordinator before the app
releases its shared notice router.

PostgreSQL 15 or newer is required by QUESTPIE. The realtime transaction id
uses the `xid8` facilities introduced in PostgreSQL 13, and the framework-wide
startup/migration preflight rejects unsupported servers before any CRDT or
realtime schema or query executes.

## Release gates

The capability is shippable only when:

- codec golden, malformed-boundary and deterministic fuzz tests pass;
- open/exchange security, idempotency, authority, presence and lost-response
  tests pass;
- offline, lifecycle, multi-field atomicity, hidden-field and frozen-pull
  scenarios pass;
- app registry and graceful TanStack Start/Nitro shutdown tests pass;
- generated manifests and migrations are no-diff on the second run;
- package typecheck/build, repository format/lint/typecheck/test gates pass;
- `@questpie/crdt-yjs` and `@questpie/tanstack-db` npm names are bootstrapped
  before the first release.
