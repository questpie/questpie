# CRDT collaborative aggregate capability contract

Status: re-ratified on 2026-07-23 after independent
domain/resource/authority, protocol/storage and public API/release reviews all
returned GO.

This is the canonical QUESTPIE framework contract for collaborative
collection-record and global aggregates.
Agent Board stores the execution graph and evidence; it does not define a
second architecture.

## Goal

Add a narrow CRDT primitive so one collection record or global can be edited as
one collaborative aggregate across multiple typed fields. It must not know
about an editor, React, Tiptap, Markdown, Knowledge, Goal, Task, Thread, Message,
Tag, or any other consumer domain.

The acceptance tracer is three participants on one `articles` record: one
edits title text, one adds/removes tag identifiers, and one edits body text.
All share one authorized session/resource lifecycle and may submit one atomic
multi-field transaction. The first qualified strategies are text and an
observed-remove add-wins set. Yjs is a private first text engine, not the public
model and not necessarily the set engine. QUESTPIE owns authorization, durable
CRDT state, synchronization, offline recovery, fencing, compaction, and
canonical field projection. Applications own field meaning and presentation.

## Baseline and reuse boundary

QUESTPIE realtime already has qualified PostgreSQL change notices, reconnect
reconciliation, commit-ordered snapshot delivery, leases, fencing, bounded
writers, and additive TanStack integration. It is not a CRDT protocol.

CRDT update bundles must not be encoded as Channel events, realtime collection
snapshots, TanStack Query deltas, or ordinary CRUD writes. The CRDT capability
uses the same qualified physical notice infrastructure only after extracting a
single core-owned multicast notice router. It owns a separate durable log,
aggregate commit cursor, field replicas/cursors/snapshots/epochs, sessions, and
binary protocol.

| Concern | Decision |
| --- | --- |
| Collection/global/field registry and generated types | Explicitly enable a collaborative owner, annotate typed field strategies, and derive one aggregate API from its field map. |
| Principal and access evaluation | Preserve the authentication discriminant and add an open Human/Agent actor seam; reuse access execution with a fresh context per decision. |
| Physical PostgreSQL/Redis wake transport | Reuse behind one multicast router started once. Broker adapters remain unchanged. |
| Commit ordering, leases, reconnect, bounded delivery | Extract proven patterns, not state or cursors. |
| Realtime outbox, txid, collection snapshot, Channel ledger | Deliberately separate. |
| TanStack Query and TanStack DB | Canonical field projections may flow through them; the live CRDT replica never does. |
| Awareness/presence | Separate CRDT session leases and ephemeral state; do not reuse provider presence identity. |

## Design decisions

### CD-01 — The primitive is a collaborative owner aggregate

The public collaboration unit is one collection record or one global
singleton. It is never the entire collection table and never a caller-visible
document per field. A normal QUESTPIE field may declare a `.crdt()` merge
strategy, while an explicit owner `.collaborative()` enables resource identity,
lifecycle, authorization, awareness, persistence and generated APIs.

One logical aggregate contains named typed field replicas. It is not one opaque
`Y.Doc`: snapshots and updates for different fields must be independently
inspectable and filterable so field read access cannot leak hidden roots. The
aggregate supplies one session, resource incarnation, aggregate epoch, schema
manifest and commit order; each field binding supplies its own engine replica,
field epoch, cursor, read/edit fences, canonical hash and revision.

V1 qualifies two strategies:

- `format: "text"` for top-level, non-localized, non-virtual, non-null,
  identity-encoded PostgreSQL text with default `""`. Both `textarea()` and
  unbounded `text({ mode: "text" })` are eligible. Varchar limits, text
  refinements, transforms and hooks fail closed because independently valid
  concurrent edits can merge to an invalid bounded value.
- `format: "set", conflict: "add-wins"` only for a top-level
  `text({ mode: "text" }).array().default([]).required()` field. It must be
  non-localized, non-virtual, identity encoded and have no element/array
  refinement, hook, transform or custom codec. V1 set elements are strings
  only. Each must be a well-formed 1..4096-byte UTF-8 string without U+0000 or
  unpaired surrogates. Equality is exact UTF-8 byte equality with no Unicode
  normalization; canonical order is unsigned lexicographic UTF-8 byte order.
  Projection is the duplicate-free decoded JSONB string array in that order.
  Semantics are observed-remove add-wins: add creates a unique dot, delete
  removes only observed dots, and a concurrent unobserved add survives.
  `select().array()`, relation/upload arrays, virtual `hasMany`/`manyToMany`,
  ordered lists, objects/maps, non-string scalars and custom field types are
  explicitly unsupported in v1.

Text values are well-formed JavaScript strings with no normalization, U+0000,
or unpaired surrogates. Indices and lengths are UTF-16 code units on scalar
boundaries. A text operation list is prevalidated atomically. A set operation
list is bounded and schema-validated atomically. Aggregate
`document.transaction()` stages operations against private field candidates;
either all touched field subupdates become one speculative bundle and one
durable receipt, or none do.

There is no Tiptap, ProseMirror, rich-text schema, React binding, Hocuspocus, or
UI package in this goal. Consumers bind any UI or headless agent to the typed
ports. Register/map/list formats require separate qualification.

### CD-02 — Declaration, manifest, generated identity and API

The candidate declaration is:

```ts
export const articles = collection("articles")
	.fields(({ f }) => ({
		title: f
			.text({ mode: "text" })
			.default("")
			.required()
			.crdt({ format: "text" }),
		tags: f
			.text({ mode: "text" })
			.array()
			.default([])
			.required()
			.crdt({ format: "set", conflict: "add-wins" }),
		content: f
			.textarea()
			.default("")
			.required()
			.crdt({ format: "text" }),
		status: f.select(["draft", "published"]).default("draft"),
	}))
	.collaborative({
		awareness: z
			.object({
				activeField: z
					.enum(["title", "tags", "content"])
					.optional(),
				cursor: z.number().int().nonnegative().optional(),
				selectionEnd: z.number().int().nonnegative().optional(),
				focused: z.boolean().optional(),
			})
			.strict(),
	});
```

`.crdt()` without `.collaborative()` is an orphan and fails typecheck where
possible and startup always. `.collaborative()` with no CRDT fields also fails.
The field list is derived from markers and never duplicated in owner config.
Globals expose the same owner capability.

`.collaborative()` accepts an optional config. With no argument, awareness is
disabled and its generated awareness type is `never`. Builder/module merging
uses ordinary QUESTPIE precedence:

- absent plus present preserves the present capability;
- present plus present uses the existing `other`-wins `.merge(other)`
  precedence; callback/Zod semantic fingerprinting is never attempted;
- a later fluent `.collaborative(config)` call on the same owner builder
  explicitly replaces its earlier owner config before that builder is
  registered;
- field strategies are always re-derived from the final field registry, so a
  copied owner config cannot create phantom or missing collaborative fields.

Codegen emits one owner-level document constructor:

```ts
const article = client.crdt.collections.articles.document({ id });
const settings = client.crdt.globals.siteSettings.document();

await article.connect({ mode: "edit" });
article.fields.title.text.apply([
	{ type: "insert", index: 0, value: "Shared " },
]);
article.fields.tags.set.add(tagId);
article.fields.content.text.apply([
	{ type: "insert", index: 0, value: "Body" },
]);
article.transaction(({ fields }) => {
	fields.title.text.apply([{ type: "insert", index: 0, value: "New " }]);
	fields.tags.set.add(tagId);
});
```

Non-CRDT fields such as `status` are absent from `article.fields`. The
constructor is synchronous and inert for SSR. It never accepts a room, tenant,
document hash, field path, epoch, fence, field slot or adapter version.

These public interfaces are normative; generated mapped types substitute exact
owner keys, field keys, set element types and awareness output:

```ts
type CrdtTextOperation =
	| { type: "insert"; index: number; value: string }
	| { type: "delete"; index: number; length: number };
type CrdtSetOperation<T extends string> =
	| { type: "add"; value: T }
	| { type: "delete"; value: T };

interface CrdtTextReplica {
	value(): string;
	apply(operations: readonly CrdtTextOperation[]): void;
}
interface CrdtSetReplica<T extends string> {
	values(): readonly T[];
	has(value: T): boolean;
	add(value: T): void;
	delete(value: T): void;
	apply(operations: readonly CrdtSetOperation<T>[]): void;
}
interface CrdtTextFieldPort {
	readonly format: "text";
	readonly text: CrdtTextReplica;
}
interface CrdtSetFieldPort<T extends string> {
	readonly format: "set";
	readonly set: CrdtSetReplica<T>;
}
type CrdtAwarenessPort<TAwareness> = [TAwareness] extends [never]
	? { readonly enabled: false }
	: {
			readonly enabled: true;
			set(value: TAwareness): void;
			clear(): void;
	  };

type CrdtFieldGrant = "view" | "edit";
type CrdtNonReadyDocumentState =
	| { status: "authorizing" }
	| { status: "connecting" }
	| { status: "synchronizing"; requestedMode: "view" | "edit" }
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
				| "aggregate_limit"
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
type CrdtDocumentState<K extends PropertyKey> =
	| { status: "idle" }
	| {
			status: "ready";
			fieldGrants: Readonly<Partial<Record<K, CrdtFieldGrant>>>;
			fieldSyncing: readonly K[];
			pendingUpdates: number;
	  }
	| {
			status: "offline";
			fieldGrants: Readonly<Partial<Record<K, CrdtFieldGrant>>>;
			pendingUpdates: number;
	  }
	| CrdtNonReadyDocumentState;

interface CrdtAggregateDocument<
	TFields extends Record<string, CrdtTextFieldPort | CrdtSetFieldPort<string>>,
	TAwareness,
> {
	readonly fields: TFields;
	readonly replicaRevision: number;
	readonly awareness: CrdtAwarenessPort<TAwareness>;
	getSnapshot(): CrdtDocumentState<keyof TFields>;
	subscribe(listener: (state: CrdtDocumentState<keyof TFields>) => void): () => void;
	connect(options: {
		mode: "view" | "edit";
		fallback?: "view";
	}): Promise<void>;
	disconnect(): Promise<void>;
	close(): Promise<void>;
	transaction(callback: (tx: { readonly fields: TFields }) => void): void;
}
```

All local field mutators return `void`. They validate the complete operation
list before publishing local state and throw `CrdtMutationError` with a closed
code: `NOT_READY`, `FIELD_HIDDEN`, `FIELD_VIEW_ONLY`, `INVALID_OPERATION`,
`QUEUE_LIMIT`, `NESTED_TRANSACTION`, or `ASYNC_TRANSACTION`. `text.value()`,
`set.values()` and `set.has()` throw `CrdtReadError` with closed code
`NOT_READY` before a readable basis is active and `FIELD_HIDDEN` after a field
is hidden/revoked. They never return a stale or empty sentinel. Read revocation
purges in-memory engine bytes and the field's offline readable cache before the
grant-change state/subscriber notification is published. A transaction
callback runs synchronously against private staged replicas, may not nest, and
must return a non-thenable. A thrown error or returned thenable discards every
staged change before subscriber notification/offline enqueue.

V1 supports exactly one immutable, bounded application namespace per database.
A singleton fixed-key row is created on an empty install and must exactly match
thereafter. The versioned internal aggregate identity is derived from namespace,
owner kind/key, canonical locator, immutable resource-incarnation UUID and
identity-contract version. Field path is not part of aggregate identity.

Each manifest entry has a stable server-assigned field ID/slot, current source
path, format/version and field epoch. Schema fingerprint/version binds tickets,
snapshots and offline queues. Add initializes a new binding from canonical
state. Rename requires an explicit generated identity mapping. Remove, format
change or incompatible schema change requires a CLI-generated manifest
migration and field-epoch fence. An old client never silently maps an update to
a new field.

Every manifest change is an aggregate control commit. Additive field add and an
explicit rename preserve existing stable slots and record a bounded
compatibility map. Every manifest change advances fences and closes all live
sessions; a new session opens only with the exact current schema. `FIELD_STATE`
never upgrades a live client across schemas. During the offline horizon, a
current generated client may replay an old queued bundle only when every
referenced slot maps one-to-one to the same stable field ID, format version and
compatible field epoch. Submitted idempotency is resolved first, then the
bundle is normalized to the current schema for admission/commit. Removal, slot
reuse, format change or incompatible codec has no compatibility mapping and
preserves the bundle as recovery-required. Compatibility maps expire with the
offline horizon and are never inferred from equal source names.

V1 bounds namespace/owner key to 64/128 ASCII bytes, field path to 256 UTF-8
bytes, and the schema-canonical locator to 4 KiB. Values are validated before
hashing, persistence, access lookup or worker admission.

One partial unique invariant permits one current resource incarnation for
`(namespace, owner kind/key, locator)`. Collection create allocates it and
seeds every field replica/snapshot in the owner transaction. Existing
records/globals lazy-activate exactly once under owner lock. Hard delete retires
the incarnation; recreate with the same external ID gets a new UUID. Soft
delete retires it. Restore/reset advances aggregate epoch; a single-field
replace advances only that field epoch.

### CD-03 — Canonical values, CRUD and aggregate projection

Normal collection/global columns and inline relation arrays remain canonical
application data. CRDT snapshots, dots and update bundles are operational merge
state, not a second domain truth.

Ordinary update, upsert, bulk, nested, seed, import, version restore and system
paths containing any CRDT-owned field reject before access, hooks or writes.
CRUD can update unrelated fields normally. Collection create may seed CRDT
fields and must create every binding/snapshot atomically. Reads return the last
successfully projected canonical values.

Generated server APIs are aggregate-first:

```ts
const article = ctx.crdt.collections.articles.document({ id });
await article.status();
await article.fields.title.replace({
	value,
	expected: { fieldEpoch, canonicalRevision },
	reason: "agent" | "import" | "restore" | "resolve",
});
await article.replace({
	fields: { title, tags, content },
	expected: { aggregateEpoch, canonicalRevisions },
	reason: "import",
});
await article.revoke({ subject, capability: "edit", tx });
```

Generated server mapped types conform to:

```ts
type CrdtEpoch = string;
type CrdtCursor = string;
declare const crdtAuthorityTargetBrand: unique symbol;
interface CrdtAuthorityTarget {
	readonly [crdtAuthorityTargetBrand]: never;
}

type CrdtServerFieldDefinition =
	| { format: "text"; value: string }
	| { format: "set"; value: readonly string[] };
interface CrdtServerFieldStatus<TFormat extends "text" | "set"> {
	format: TFormat;
	fieldEpoch: CrdtEpoch;
	headCursor: CrdtCursor;
	projectedCursor: CrdtCursor;
	canonicalRevision: string;
	status: "active" | "retired" | "write_suspended";
}
interface CrdtServerField<TDefinition extends CrdtServerFieldDefinition> {
	status(): Promise<CrdtServerFieldStatus<TDefinition["format"]>>;
	replace(input: {
		value: TDefinition["value"];
		expected: { fieldEpoch: CrdtEpoch; canonicalRevision: string };
		reason: "agent" | "import" | "restore" | "resolve";
	}): Promise<CrdtServerFieldStatus<TDefinition["format"]>>;
	authorityTarget(input: {
		subject: CrdtAuthoritySubject;
		capability: "read" | "edit";
	}): CrdtAuthorityTarget;
	revoke(input: {
		subject: CrdtAuthoritySubject;
		capability: "read" | "edit";
		tx: unknown;
	}): Promise<CrdtServerFieldStatus<TDefinition["format"]>>;
}
interface CrdtServerDocumentStatus<
	TFields extends Record<string, CrdtServerFieldDefinition>,
> {
	status: "active" | "retired" | "write_suspended";
	aggregateEpoch: CrdtEpoch;
	headCommit: CrdtCursor;
	projectedCommit: CrdtCursor;
	fields: Partial<{
		[K in keyof TFields]: CrdtServerFieldStatus<TFields[K]["format"]>;
	}>;
}
interface CrdtServerDocument<
	TFields extends Record<string, CrdtServerFieldDefinition>,
> {
	readonly fields: {
		[K in keyof TFields]: CrdtServerField<TFields[K]>;
	};
	status(): Promise<CrdtServerDocumentStatus<TFields>>;
	replace(input: {
		fields: { [K in keyof TFields]: TFields[K]["value"] };
		expected: {
			aggregateEpoch: CrdtEpoch;
			canonicalRevisions: { [K in keyof TFields]: string };
		};
		reason: "agent" | "import" | "restore" | "resolve";
	}): Promise<CrdtServerDocumentStatus<TFields>>;
	authorityTarget(input: {
		subject: CrdtAuthoritySubject;
		capability: "read" | "edit";
	}): CrdtAuthorityTarget;
	revoke(input: {
		subject: CrdtAuthoritySubject;
		capability: "read" | "edit";
		tx: unknown;
	}): Promise<CrdtServerDocumentStatus<TFields>>;
}
```

`status()` first requires current owner read access and returns only currently
readable field entries; hidden fields are absent and indistinguishable from
unavailable fields. Phantom/non-CRDT field keys fail in generated types.

`status()` exposes string-encoded aggregate/field epochs, cursors and canonical
revisions without internal IDs. Single-field replace advances only its field
epoch and leaves unrelated offline work valid. Aggregate replace/reset advances
the aggregate epoch, requires values and expected canonical revisions for every
collaborative field, rejects unknown/extra/missing keys at runtime, and is
atomic. Partial server replacement uses the exact field handle; the aggregate
method never has ambiguous partial-epoch semantics.

Every field replace/reset is linearized as a durable aggregate control commit:
under the normal locks it allocates the next aggregate `commitSeq`, installs the
new field epoch/snapshot/canonical value, records the manifest generation and
inserts exactly one normal owner outbox change with bounded
`origin: "crdt_replace"` in the same transaction. It commits before wake plus
`FIELD_STATE action=reset`. Aggregate replace/reset is the equivalent
aggregate-epoch control commit, emits exactly one owner outbox change and
forces reconnect. Outbox identity is derived from the durable control commit,
so retry/crash recovery cannot duplicate it. Therefore bootstrap cuts, HA
drains, projection, realtime consumers and live clients observe reset in one
order; there is no same-sequence out-of-band field epoch change.

A field-reset control commit does not advance `aggregateProjectedCommit` past
older unprojected commits. The reset transaction writes the canonical value and
verified `(newFieldEpoch, cursor 0)` basis atomically, while the aggregate
projection checkpoint stays at its prior cut. When the projector crosses that
barrier it treats the reset field basis as already canonical, still projects
older unrelated field changes in order, verifies all active binding revisions,
and only then advances the aggregate checkpoint through the control commit. It
does not emit the already-canonical reset field again; it emits a projection
outbox change only for older unrelated fields it actually projects.

One accepted client update ID represents a canonical sorted bundle of field
subupdates. It gets one gap-free aggregate commit sequence and receipt. Each
server-assigned slot resolves one authorized binding; bounded engine inspection
must prove that part is confined to that binding's private root and derive all
of its structs/dots/deletes. Client field paths or slot claims are never
authority. Unknown, hidden, stale-epoch, malformed or unauthorized parts reject
the entire bundle; no partial commit exists.

Projection materializes one verified aggregate cut through commit `P`, locks
owner row before aggregate header and sorted bindings, CAS-verifies all touched
canonical hashes/revisions and also verifies every active binding's canonical
hash/revision against its last projection, then writes every touched SQL
column/array in one transaction. A mismatch in any active binding suspends the
aggregate before a partial write. It then advances per-field projection
metadata and aggregate projected sequence and emits exactly one normal
realtime/outbox owner change with `origin: "crdt_projection"`. Unrelated owner
fields are untouched.

For text, canonical projection is the exact qualified engine string. For set,
it is the canonical duplicate-free deterministic order of decoded values.
Markdown parsing, product validation, typed references and checkpoint policy
remain consumer concerns.

Old aggregate/field epochs, incarnations and already-projected cuts are
idempotent no-ops. Raw mismatch in any CRDT-owned canonical field suspends the
aggregate to prevent partial projection. The projector uses a dedicated
internal write seam with no fabricated principal, access callback, mutation
hook or version snapshot. The first unprojected bundle gets
`dueAt <= committedAt + 5s`; later bundles cannot postpone it.

Every cross-state operation locks owner row, aggregate header, then sorted field
bindings. Native relation-set semantics are deferred; a string tag ID has exact
external-ID equality and no framework referential guarantee. Owner delete
retires/fences the aggregate in the same transaction.

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

type CrdtAuthoritySubject =
	| { kind: "human"; subjectId: string }
	| { kind: "agent"; issuer: string; subjectId: string };

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
envelope branch. Every verified actor derives one stable authority subject:
Human `(kind, subjectId)`, Agent `(kind, canonical issuer, subjectId)`.
Admission ownership and durable read/edit fences are keyed by that tuple.
Credential id/fingerprint, scopes and expiry remain separate credential caps
and audit attribution; rotation cannot evade the subject fence and equal
subject IDs from different issuers cannot collide. `crdt:read` is mandatory for
view and `crdt:read` plus `crdt:edit` for edit. Scope and expiry are rechecked on
every fresh decision and remain additional gates, never replacements for
application access. Legacy user-only callbacks see `principal: undefined` for
an Agent and fail closed; Agent-aware rules use `actor`. System or a missing
verified envelope is rejected before resource resolution.

Access and field-access contexts expose `principal` and `actor`. Authorization
must not observe projection-lagged CRDT values. Before any owner/field
read/edit/`AccessWhere` decision, the kernel loads the current SQL row/global,
materializes a verified aggregate cut, and overlays every active CRDT binding's
canonical value onto one server-internal policy record regardless of the
caller's field visibility. Read gates filter only grants and serialized output;
the policy record and hidden values never cross the server policy seam. The
staged authorization token records sorted
`(stableFieldId, fieldEpoch, fieldCursor)` tuples for every active binding.
Under the append lock every tuple must remain unchanged or the entire
authorization/staging pass retries with a bound; equal cursors across a field
reset therefore cannot validate a stale policy overlay. No update commits in a
five-second projection authority window.

Edit reuses the owner update rule fail-closed with the overlaid current record
and a frozen empty ordinary input; a patch-dependent rule that throws or
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
aggregates and bindings lock second in sorted order, and the subject fences advance
in the same transaction:

```ts
await ctx.crdt.withAuthorityMutation(
	[
		ctx.crdt.collections.articles
			.document({ id })
			.authorityTarget({ subject, capability: "read" }),
	],
	async (tx) => {
		await updatePermission(tx);
	},
);
```

The generated single-resource convenience is:

```ts
await ctx.crdt.collections.articles
	.document({ id })
	.revoke({ subject, capability: "edit", tx });
```

It is legal only inside a transaction that follows the same lock order.
Multi-aggregate inputs are sorted by internal id before locking.

```ts
const article = ctx.crdt.collections.articles.document({ id });
await article.status();
await article.fields.content.replace({
		value,
		expected: { fieldEpoch, canonicalRevision },
		reason: "agent" | "import" | "restore" | "resolve",
});
```

Global document constructors omit `{ id }`. Results expose string-encoded
aggregate/field epochs, cursors and canonical revisions plus typed status;
internal references and slots never cross the seam.

Opaque external access callbacks without this seam honestly guarantee
revalidation before the next accepted update/outbound batch and within
15 seconds for idle sessions, not instantaneous revocation.

### CD-05 — Explicit modes and client lifecycle

A session requests aggregate `view` or `edit`. Owner read plus at least one
readable CRDT field is mandatory. `view` grants view for every readable field.
For `edit`, each readable field independently receives edit only when owner
update, field update and optional CRDT edit gates all pass; otherwise it remains
view. The connection succeeds in edit mode when at least one field is editable.
This explicit mixed `fieldGrants` result is not a downgrade. When no field is
editable, only explicit `fallback: "view"` may continue and only with no pending
bundle; otherwise connect denies or enters `recovery-required`.

The generated constructor is synchronous and inert. It performs no network,
ticket, Worker, or IndexedDB operation during SSR or render:

```ts
const document = client.crdt.collections.articles.document({ id });
const globalDocument = client.crdt.globals.siteSettings.document();

const unsubscribe = document.subscribe((state) => {
	if (state.status === "ready") {
		console.log(document.fields.content.text.value(), state.fieldGrants);
	}
});

await document.connect({ mode: "edit", fallback: "view" });

document.fields.content.text.apply([
	{ type: "insert", index: 0, value: "Shared text" },
]);
document.fields.tags.set.add(tagId);
```

The immutable, data-only state is the generic `CrdtDocumentState<K>` union in
CD-02, where `K` is the exact collaborative field-key union. Ready/offline
`fieldGrants` are partial because unreadable fields are absent, not represented
by a denial sentinel.

Methods remain on the handle, not in state. The handle defines
`getSnapshot()`, `subscribe()`, idempotent `connect()`/`disconnect()`/`close()`,
and a monotonic `replicaRevision` incremented for every field revision even when
status is unchanged. `close()` is terminal; reconnect requires a new handle.
`connect()` is explicitly client-only and StrictMode/ref-count safe.

Field mutations are allowed only with that field's `edit` grant in ready or
same-epoch offline mode below the local queue cap. Hidden/view-only, idle,
connecting, suspended, recovery-required and closed calls fail synchronously
before local mutation. `transaction()` checks every touched field and stages
all-or-nothing. The origin replica may show a speculative local bundle before
server commit and marks it in `pendingUpdates`. Durable-before-visible means no
server ACK, remote broadcast, projection, or server-authoritative replica
mutation before commit. A rejected speculative bundle is preserved as one
opaque recovery artifact; it is never silently split, discarded or uploaded
under lost authority.

Field read revocation emits no final snapshot/update for that field and removes
its local readable replica; other authorized fields may remain connected. Edit
revocation fences writes first and updates the field grant. Owner-wide read
revocation closes the aggregate without a final document, roster or awareness
frame.

After a grant change, a pending bundle touching any newly hidden/view-only field
is preserved whole as `recovery-required`; it is never split. Pending bundles
touching only still-editable fields remain eligible for receipt reconciliation
and replay.

A same-schema newly readable field or field-epoch reset uses a two-phase
field-sync while the aggregate remains `ready`. `FIELD_STATE action=2` removes
the slot from active `fieldGrants`, purges/holds its replica, records it in
`fieldSyncing`, and pauses updates for that slot. The client performs one
correlated field-only `SYNC_PROOF → SYNC_CHUNK/SYNC_ACK` exchange. After final
chunk ACK and a durable drain to a stable field cut, the server emits
`FIELD_STATE action=0` with the active grant/epoch/head; only then is the slot
removed from `fieldSyncing`, installed in `fieldGrants`, readable and mutable.
Unrelated ready fields remain usable throughout. Read revoke during field-sync
cancels the correlation, purges staged bytes and makes later chunks for it
invalid; a racing field commit is included by the stable drain or delivered
after activation, never lost.

### CD-06 — CRDT engine and transport adapters

The kernel owns private, independent seams:

- typed field engines implementing framework `text` and add-wins `set`
  semantics, update inspection, merge, state proof, snapshot materialization
  and deterministic projection;
- an aggregate coordinator that validates/stages sorted multi-field bundles and
  produces one receipt/commit cursor without merging hidden field bytes;
- a binary transport carrying kernel frames without interpreting CRDT bytes.

Yjs 13 is the first qualified text engine in `@questpie/crdt-yjs`. The set
engine is a non-configurable core implementation in v1 and must independently
qualify the observed-remove add-wins contract. It is not implemented through a
Yjs map. Yjs is never present in application-facing `.d.ts` or root exports.
Hocuspocus is not used. QUESTPIE owns persistence and
durable-before-visible ordering.

Server and client configuration are explicit generic ports:

```ts
runtimeConfig({
	crdt: {
		namespace: "acme-cms",
		engines: { text: yjsServerEngine() },
		allowedOrigins: ["https://admin.example.com"],
		authenticateAgent: verifyAgentCredential,
	},
});

createClient<AppConfig>({
	crdt: {
		namespace: "acme-cms",
		path: "/crdt",
		engines: { text: yjsClientEngine() },
	},
});
```

No collaborative owners leaves the runtime dormant. An owner with an orphan or
unsupported field strategy, missing required text engine, or missing host
capability fails startup; a client without the matching text engine fails
`connect()` with a typed error. The built-in v1 set engine is selected by the
kernel and has no registry/config key.

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
| C→S | `SYNC_PROOF` | `0x02` | aggregate syncing or ready/field-syncing | `u32 schemaVersion + u16 partCount + repeated(u16 fieldSlot + u64 fieldEpoch + u32 proofLength + proof)` |
| C→S | `SYNC_ACK` | `0x03` | aggregate syncing or ready/field-syncing | `u32 chunkIndex + u16 fieldSlot + u64 throughFieldCursor` |
| C→S | `UPDATE` | `0x04` | ready/edit or offline replay | `updateId[16] + u64 aggregateEpoch + u32 schemaVersion + u16 partCount + repeated(fieldPart)` |
| C→S | `AWARENESS` | `0x05` | ready | `u32 bytesLength + RFC 8785 JSON UTF-8` |
| C→S | `HEARTBEAT` | `0x06` | authenticated | empty |
| C→S | `CLOSE` | `0x07` | authenticated | empty |
| C→S | `RECEIPT_QUERY` | `0x08` | syncing/ready | `u16 count + repeated(updateId[16] + SHA-256[32] + u64 aggregateEpoch + u32 schemaVersion)` |
| S→C | `READY` | `0x81` | syncing→ready | `u64 aggregateEpoch + u32 schemaVersion + u16 grantCount + repeated(fieldGrant)` |
| S→C | `SYNC_CHUNK` | `0x82` | aggregate syncing or ready/field-syncing | `u32 chunkIndex + u16 fieldSlot + u64 fieldEpoch + u64 throughFieldCursor + u8 final + u32 bytesLength + bytes` |
| S→C | `UPDATE` | `0x83` | ready | `commitId[16] + u64 aggregateEpoch + u16 partCount + repeated(committedFieldPart)` |
| S→C | `UPDATE_ACK` | `0x84` | ready | `updateId[16] + u64 aggregateEpoch + u16 cursorCount + repeated(u16 fieldSlot + u64 fieldCursor)` |
| S→C | `AWARENESS` | `0x85` | ready | `u32 bytesLength + RFC 8785 JSON UTF-8` |
| S→C | `FIELD_STATE` | `0x86` | syncing/ready | `u32 schemaVersion + u16 count + repeated(fieldTransition)` |
| S→C | `ERROR` | `0x87` | any accepted state | `u16 code + u8 retryable + u32 retryAfterMs + 16-byte correlationId` |
| S→C | `HEARTBEAT_ACK` | `0x88` | authenticated | `u64 serverTimeMs` |
| S→C | `AUTH_OK` | `0x89` | unauthenticated→authenticated | `u64 aggregateEpoch + u32 schemaVersion` |
| S→C | `SUSPENDED` | `0x8a` | read-authorized | `u8 suspendedReason` |
| S→C | `RECEIPT_ACK` | `0x8b` | syncing/ready | `u16 count + repeated(updateId[16] + u64 aggregateEpoch + u16 cursorCount + repeated(fieldSlot + fieldCursor))` |

`fieldPart` is exactly `u16 fieldSlot + u64 fieldEpoch + u16 formatVersion +
u64 baseFieldCursor + u32 bytesLength + bytes`. Parts are strictly increasing
by server-assigned slot, unique and nonempty. `committedFieldPart` replaces
`baseFieldCursor` with assigned `u64 fieldCursor`. `fieldGrant` is exactly
`u16 fieldSlot + u8 grant + u64 fieldEpoch + u64 headFieldCursor`, where grant
is view `0` or edit `1`. A client never sends a field path. A declared slot is
only routing metadata: bounded engine inspection must prove the update touches
only that binding and must derive all structs/dots/deletes before authorization.

`fieldTransition` is exactly `u16 fieldSlot + u8 action + u8 grant +
u64 fieldEpoch + u64 headFieldCursor`. Action `0` grants/changes view-or-edit;
action `1` revokes read and requires immediate local purge (grant/epoch/cursor
must be zero); action `2` starts same-schema field-only sync, requires grant
zero as a sentinel, carries the required field epoch/head, and is completed
only by a later action `0` after the stable drain. Newly readable fields use the
same action `2`→sync→action `0` sequence. Transitions are sorted and unique.
Owner-wide read revoke closes with policy code and no final field frame.

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

One connection carries one server-resolved aggregate. Only `AUTH` is accepted
before ticket redemption. Later frames cannot carry aggregate identity or
authority. WebSocket close mapping is fixed: normal `1000`, protocol `1002`,
authorization/policy `1008`, size `1009`, transient internal/transport `1011`.
Field grant values are view `0` and edit `1`. Error values 1–6 map in order to the six public codes
in CD-15; `retryAfterMs=0` means absent. Suspended reasons 1–3 are canonical
conflict, aggregate limit, and engine quarantine.

Normative framing vectors below use connection sequence 1, request id 1 for
correlated frames and zero otherwise. Bundle/grant/receipt vectors deliberately
contain two nonempty field entries to freeze repeated grammar. Other empty
IDs/proofs are parser vectors; semantic validation may reject them after
decoding.

- AUTH: `5150435201000100000000000000000100000000000000010000000300000000000141`
- SYNC_PROOF: `5150435201000200000000000000000100000000000000010000000600000000000000010000`
- SYNC_ACK: `5150435201000300000000000000000100000000000000000000000e000000000000000000000000000000000000`
- UPDATE: `515043520100040000000000000000010000000000000001000000510000000000112233445566778899aabbccddeeff0000000000000003000000090002000100000000000000010001000000000000000500000001aa000200000000000000020001000000000000000700000002bbcc`
- AWARENESS C→S: `5150435201000500000000000000000100000000000000000000000600000000000000027b7d`
- HEARTBEAT: `5150435201000600000000000000000100000000000000010000000000000000`
- CLOSE: `5150435201000700000000000000000100000000000000000000000000000000`
- RECEIPT_QUERY: `5150435201000800000000000000000100000000000000010000003e00000000000100112233445566778899aabbccddeeffaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa000000000000000300000009`
- READY: `515043520100810000000000000000010000000000000001000000340000000000000000000000030000000900020001010000000000000001000000000000000600020000000000000000020000000000000008`
- SYNC_CHUNK: `5150435201008200000000000000000100000000000000010000001b00000000000000000000000000000000000100000000000000000100000000`
- UPDATE S→C: `5150435201008300000000000000000100000000000000000000004d00000000ffeeddccbbaa9988776655443322110000000000000000030002000100000000000000010001000000000000000600000001aa000200000000000000020001000000000000000800000002bbcc`
- UPDATE_ACK: `5150435201008400000000000000000100000000000000010000002e0000000000112233445566778899aabbccddeeff000000000000000300020001000000000000000600020000000000000008`
- AWARENESS S→C: `5150435201008500000000000000000100000000000000000000000600000000000000027b7d`
- FIELD_STATE GRANT: `5150435201008600000000000000000100000000000000000000001a000000000000000100010001000000000000000000010000000000000000`
- FIELD_STATE REVOKE: `5150435201008600000000000000000100000000000000000000001a000000000000000100010001010000000000000000000000000000000000`
- FIELD_STATE RESET: `5150435201008600000000000000000100000000000000000000001a000000000000000100010002020000000000000000020000000000000008`
- ERROR: `51504352010087000000000000000001000000000000000100000017000000000001000000000000000000000000000000000000000000`
- HEARTBEAT_ACK: `51504352010088000000000000000001000000000000000100000008000000000000000000000000`
- AUTH_OK: `5150435201008900000000000000000100000000000000010000000c00000000000000000000000100000001`
- SUSPENDED: `5150435201008a0000000000000000010000000000000000000000010000000001`
- RECEIPT_ACK: `5150435201008b00000000000000000100000000000000010000003000000000000100112233445566778899aabbccddeeff000000000000000300020001000000000000000600020000000000000008`

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
| fields per aggregate / parts per bundle | 32 / 32 |
| one field subupdate or sync chunk | 256 KiB |
| one atomic aggregate bundle | 1 MiB |
| canonical UTF-8 text per field | 16 MiB |
| set elements / canonical element | 10,000 / 4 KiB |
| encoded field snapshot / aggregate snapshot manifest | 24 MiB / 32 MiB |
| total initial sync | 64 MiB |
| inbound staged queue per session | 32 frames and 1 MiB |
| outbound aggregate queue per session | 256 frames and 4 MiB |

Aggregate bundles and their field parts are ordered, non-coalescing, and never
dropped. A slow
consumer is closed and resynchronizes. Awareness is the only latest-wins class.
All queues are bounded by both count and bytes. Initial sync uses a pull/ACK
window at most 4 MiB; it never queues the full state. `READY` is legal only
after basis chunks and a pre-ready durable drain watermark are acknowledged.
Each 64 KiB field proof/state vector is worker-validated and optimization-only:
it is never authority, epoch/fence, GC input, or proof that the peer is caught
up. Invalid/missing proof receives verified full state for that authorized
field. Hidden-field activity never appears as a client-visible cursor gap.

### CD-08 — Tickets and admission

Ticket issue first applies bounded IP/credential pre-admission, then
authenticates, applies the browser/headless Origin rules in CD-04, rejects
`system`/anonymous, resolves the aggregate manifest and authorized field
grants, evaluates authority, and
reserves global admission before returning a 30-second one-use ticket with at
least 256 bits of secret entropy.

The database stores only a public random id plus keyed secret hash, internal
aggregate reference, subject/credential fingerprint, audience/origin, requested
mode and field grants, protocol/engine/schema versions, aggregate/field epochs
and fences, expiry, and
redemption time. The ticket is sent only in the first binary AUTH frame, never
in a URL. Redemption is one atomic conditional update; concurrent redemption
has exactly one winner. A redeemed ticket creates a durable session grant and
is never itself continuing authority.

Defaults:

- five active sessions per authority subject across all instances;
- 100 sessions per aggregate across all instances;
- 60 updates/second/session, burst 120;
- 1 MiB update bytes/second/session, burst 2 MiB;
- 1,000 field parts/second/aggregate, burst 2,000;
- 20 awareness updates/second/session;
- 10 ticket issues/minute/credential and 30/minute/subject;
- five-second unauthenticated deadline and one unauthenticated frame;
- 256 unauthenticated upgrade sockets per instance and five per trusted
  proxy-resolved client IP.

Hard global caps use durable subject and aggregate admission-head rows. Ticket
issue locks both in canonical order, counts DB-time-active sessions plus
unexpired reservations, and inserts one reservation atomically. Redemption
converts that reservation to a leased session without double counting.
Expiry/release is query-correct before cleanup; cleanup only reclaims rows.
Exact aggregate/session rate buckets update under the aggregate/session
locks. The process-local `RealtimeAdmissionRegistry` is not reused.
Collaboration uses bounded `tryAcquire` semaphores and a separate cap on
unauthenticated sockets; it never uses an unbounded pending array.

Untrusted engine work runs in a bounded, terminable worker pool with one
process-local optimization lane per aggregate, 2×CPU active workers, at most 64
pending jobs and 128 active materialized field replicas, a 100 ms field-part
budget, a 250 ms aggregate-bundle budget, and
two-second initial materialization budget. Qualification must demonstrate a
hard 64 MiB per-job RSS/ArrayBuffer ceiling or terminate the isolated worker at
the first enforceable host limit with bounded measured overshoot. `Promise.race`
is not a CPU or memory limit.

### CD-09 — Durable namespace

CLI-generated migrations create framework-owned tables:

- `questpie_crdt_namespace`: verified immutable application namespace;
- `questpie_crdt_resource`: owner kind/key/locator, exactly one current
  incarnation and aggregate header with identity/schema versions, status,
  aggregate epoch, head/projected commit sequence and room fences;
- `questpie_crdt_binding`: resource incarnation, stable field id/slot, current
  source path, format/version, field epoch/cursor, read/edit fences, canonical
  hash/revision, projection pair, active/retired state and unique current slot;
- `questpie_crdt_schema_compatibility`: immutable owner-definition source
  version/fingerprint, target version/fingerprint, exact
  slot→stable-field-ID/format mapping, manifest control commit and expiry;
- `questpie_crdt_commit`: `(resource, aggregateEpoch, seq)`, kind
  (`update | field_reset | aggregate_reset | manifest_change`), immutable
  normalized canonical bundle/control hash and current schema version,
  attributed subject/session, and a server-random 128-bit `deliveryCommitId`
  unique per resource incarnation and stable across every replay/wake;
- `questpie_crdt_update`: one sorted field part belonging to a commit, immutable
  `bytea`, field epoch/cursor/base cursor, format version, exact length and
  SHA-256;
- `questpie_crdt_update_receipt`: client update id, submitted schema version,
  submitted bundle hash, authority subject and committed result retained for
  the entire supported offline horizon, independent of update compaction;
- `questpie_crdt_snapshot_manifest`: immutable verified aggregate cut with
  resource/aggregate epoch, schema fingerprint and `coversCommitSeq`;
- `questpie_crdt_snapshot`: one immutable verified field snapshot attached to a
  manifest with field epoch/cursor, engine/state versions, size and checksum;
- `questpie_crdt_ticket`, `questpie_crdt_session`,
  `questpie_crdt_subject_fence`;
- `questpie_crdt_subject_admission`, `questpie_crdt_resource_admission`;
- `questpie_crdt_awareness`: current expiring session state only;
- `questpie_crdt_projection`: idempotent projection work/status and expected
  canonical revision;
- `questpie_crdt_lease`: fenced compaction/migration/projector lease.

Sequences and epochs are PostgreSQL bigint and cross TypeScript/wire boundaries
as exact bigint/string values, never unsafe JavaScript numbers. DB time owns
leases. Resolved identity is bounded, framework-private, versioned, and excluded
from logs/metrics. Deletion/retirement is explicit; history is not casually
cascade-deleted.

Required invariants include gap-free primary key
`(resource, aggregateEpoch, commitSeq)`, unique receipt
`(resource, aggregateEpoch, updateId)` with stored submitted hash/schema/subject,
unique field cursor `(binding, fieldEpoch, fieldCursor)`, one active stable
slot/path per resource manifest, unique `(resource, deliveryCommitId)`, part primary/FK
`(resource, aggregateEpoch, commitSeq, fieldSlot)`, one field snapshot per
`(snapshotManifest, binding)`, nonnegative sequence/byte checks, bounded
key/path lengths, lease/session/reservation expiry indexes, and no cascade
capable of deleting the only recovery basis. For one owner definition, a
`u32 schemaVersion` is permanently bound to exactly one fingerprint and is
never reused; every compatibility row references both persisted bindings and
its durable `manifest_change` control commit.

### CD-10 — Atomic append and revocation ordering

Each field engine stages its candidate part against a verified
`(fieldEpoch, baseFieldCursor)` replica. Text inspection validates exactly one
private text root plus struct/delete/pending-dependency counts and string
bounds. Set inspection validates canonical elements, dots, observed remove
contexts, counts and resulting bounds. Unknown roots, cross-field references or
unattributable structs/dots fail closed. The coordinator validates the sorted
part set, schema fingerprint, aggregate epoch, bundle hash and aggregate limits.
The immutable staged token contains every verified field basis/result and one
all-or-nothing bundle digest.

`submittedBundleHash` is SHA-256 over the exact canonical network-order UPDATE
payload bytes after `updateId`: `aggregateEpoch + submittedSchemaVersion +
partCount + repeated(fieldPart)`. It therefore represents what the client can
reproduce after a lost ACK. A compatible old-schema bundle keeps that submitted
schema/hash in its receipt; the committed row separately stores the normalized
current schema and canonical bundle hash.

Append:

1. Parse/validate the complete frame, immutable bytes, submitted hash, rates and
   session before allocating field work.
2. Rebuild principal/context and current read authority, then perform a short
   aggregate-locked submitted-idempotency lookup. The same update
   id/submitted hash/schema/authority subject returns its original readable
   receipt before compatibility normalization or basis CAS. A mismatch is a
   protocol violation. If absent, release the lock and continue.
3. Resolve a persisted unexpired compatibility map when needed, normalize to
   the exact current schema, and evaluate owner read/update plus every touched
   field read/edit rule outside locks; capture subject, decision expiry and
   observed durable fences plus sorted
   `(stableFieldId, fieldEpoch, fieldCursor)` for every active binding used by
   the authorization overlay. A denied part denies the whole bundle.
4. Stage every normalized part against its verified field basis in bounded
   workers.
5. Begin a transaction and lock owner row, aggregate header, then sorted
   touched bindings.
6. Run no application callback. Re-read aggregate/field status, epochs,
   schema fingerprint, room/subject/field fences, session generation/grants,
   lease and decision expiry.
7. Re-resolve submitted idempotency before any basis CAS to close the duplicate
   race: the exact submitted tuple returns its original receipt even when later
   commits advanced field heads; any mismatch is a protocol violation.
8. Only for a genuinely new update, require every touched head field
   epoch/cursor to equal its staged basis and every authorization-overlay
   `(stableFieldId, fieldEpoch, fieldCursor)` tuple to remain unchanged.
9. Allocate gap-free `commitSeq = aggregateHead + 1`; allocate one next cursor
   per touched field; insert normalized commit, sorted parts and the submitted
   receipt tuple;
   advance aggregate/field heads and budgets.
10. Commit.
11. Publish a metadata-only wake; durable drain applies to local replicas,
   selective broadcasts and acknowledgement.

If the basis is stale, discard it and restage with a bounded retry budget; a
process lane is only an optimization and DB comparisons are the HA
serialization. Append, replace, delete and every fence mutation lock the same
aggregate header. That lock is the durable authority linearization point. Read
revoke advances read and edit fences for the target field or aggregate; edit
revoke advances edit only. No mixed bundle commits after any touched binding's
revoke transaction.

Nothing mutates a server-authoritative replica, acknowledges, remotely
broadcasts, wakes, or projects before commit. The speculative origin behavior
is defined by CD-05.

If local apply fails after commit, affected replicas rebuild from durable state;
deterministic repeated failure quarantines it. Lost acknowledgements retry
idempotently. Rollback creates no commit, part, receipt, wake or cursor
advance.

Lost-ACK reconciliation does not require current edit authority. During
read-authorized sync/view, `RECEIPT_QUERY` accepts at most 64
`(updateId, SHA-256, aggregateEpoch, schemaVersion)` tuples and returns only
matching durable receipts for the same aggregate, authority subject,
`submittedBundleHash` and `submittedSchemaVersion` when the caller still has
read access to every part in that receipt. It never creates or normalizes an
update. Missing/wrong subject/hash/resource/epoch/schema or hidden part is
indistinguishable from absent. This lets a client clear one already durable
atomic bundle and safely enter explicit fallback after edit revocation.

### CD-11 — Gap-free bootstrap, HA wake, and reconciliation

Open/reconnect:

1. Freshly resolve aggregate manifest and per-field authority; create a syncing
   session bound to aggregate/field epochs, schema version and fences.
2. In one repeatable-read basis, read aggregate header `(epoch, commitHead=N)`,
   one verified aggregate snapshot manifest, authorized field snapshots and
   their tails through N. Hidden fields are never materialized or serialized.
3. Materialize each authorized field replica in bounded workers.
4. Register the local internal aggregate drain cursor at N before the final
   basis chunk. This cursor is never exposed to clients with hidden fields.
5. Send authorized field bases through the bounded ACK window.
6. Repeatedly read aggregate head, drain `>cursor`, filter authorized parts,
   and require an acknowledged stable per-field cut before ready. A racing
   commit is included by the loop or a later wake; hidden-only commits create
   no visible client cursor gap.

Wakes are latency hints only. App core owns one multicast notice router,
starting it before Realtime/CRDT subscribers and stopping it after both
unsubscribe. RealtimeService no longer owns the physical broker lifecycle.
Subscriber queues are isolated and bounded so a failing/slow CRDT subscriber
cannot delay realtime. The router multiplexes normalized `realtime` and `crdt`
kinds; every instance with local sessions drains on wake, immediately after
broker reconnect, every 2 seconds when healthy, and every 250 ms while a local
aggregate is known behind. Drop, duplicate, reorder, and loss cannot change
correctness. Broker payloads contain only bounded kind, opaque aggregate hash,
epoch/head/fence generation; never CRDT bytes or application identity.

Rolling rollout enables CRDT only after every replica recognizes the new
normalized wake kind. Graceful stop order is: stop ticket/frame admission;
reject new worker jobs; bounded-wait in-flight inspection/append under DB
statement deadlines; stop drains; close sessions/awareness; best-effort lease
cleanup; stop host transport; unsubscribe router. The physical router stops
last at app shutdown. A committed update with lost shutdown ACK remains
idempotently retryable; no callback may create a broker listener/client after
stop.

CRDT aggregate commit sequence is per resource-incarnation/aggregate epoch and
is never realtime txid, outbox sequence, Channel event id or a client-visible
selective-read cursor.

### CD-12 — Snapshots, compaction, retention, and projection

Compaction uses a fenced lease:

1. Capture one verified same-aggregate-epoch cut through commit N, every active
   binding's field epoch/cursor, and all field tails needed for that cut.
2. Materialize and validate every field replica outside the aggregate lock.
3. Write immutable checksummed field snapshots plus one aggregate manifest and
   read-verify the complete manifest.
4. CAS-publish the pointer for the same aggregate epoch/schema/lease generation.
5. Only after pointer commit, run bounded GC.

Crashes before pointer leave an orphan; crashes after pointer leave a safe
leak. Keep current and previous verified aggregate manifests plus every commit
header and every update part after the previous manifest cut. Control commit
headers are retained even when they have no update part. Before a previous
manifest exists, retain every current-epoch commit. A manifest is publishable
only when it covers every active binding at one aggregate cut. Corrupt current
state rebuilds from the previous complete manifest plus retained
bundles/control barriers before quarantine. Session acknowledgements are never
GC authority. Retain receipts, aggregate epochs and retired field epochs for
the default 30-day offline/recovery horizon. Recovery holds are bounded and
expiring.

Initial compaction triggers are 512 commits or 4 MiB since the current manifest,
but every candidate bundle already enforces per-field and aggregate limits at
its staged basis. A hard-limit crossing rejects the whole bundle before commit.
Corrupt or pre-existing oversize state becomes `write_suspended`; view/export
remain possible.

Projection is asynchronous operational work:

- projects a verified aggregate cut to all touched canonical fields;
- uses every expected canonical revision/hash and one idempotency key;
- records aggregate projected commit and per-field projected cursors separately
  from their heads;
- uses the non-starving five-second due time from CD-03; session close only
  accelerates it;
- failure never deletes CRDT state;
- CAS conflict suspends writes rather than applying last-write-wins.

### CD-13 — Epochs, offline work, and recovery

Each local aggregate transaction receives one persistent random id before
entering a bounded offline queue. Queue keys include credential subject,
application, resource incarnation, aggregate epoch, schema fingerprint and all
touched field epochs. Queue limits freeze further editing; they never evict or
split a bundle silently. A bundle is removed only after its matching durable
receipt.

Compatible reconnect within the 30-day horizon first synchronizes authorized
field state, then replays local bundles idempotently. A field replace invalidates
only queued bundles touching that old field epoch; unrelated field work remains
replayable. Queue age beyond the horizon requires recovery/export. Aggregate
epoch, resource incarnation or schema incompatibility never auto-uploads old
bytes; it enters
`recovery-required` and preserves an opaque export artifact for explicit
application recovery. Logout/account change purges or explicitly exports that
credential's queue; one user cannot observe another user's pending work.

Single-field replace follows owner→aggregate→binding locks, advances that field
epoch/fences and installs its verified canonical basis without invalidating
other fields. Restore, incompatible aggregate/schema migration and destructive
reset advance aggregate epoch, fence affected sessions, install one verified
aggregate manifest/canonical basis and reject old aggregate bundles. Migration
is a fenced online workflow with durable stages and rollback basis, not DDL and
never an empty fallback.

### CD-14 — Roster and awareness

Roster comes from durable, lease-backed server sessions. Identity, subject
grouping, aggregate identity and field grants are server-derived. Tabs/devices
are separate sessions and may be grouped only in the projection. Every roster
and awareness projection is recipient-filtered: a recipient sees a participant
only when they share at least one currently readable field, sees only the
intersection of their readable field activity, and never receives the other
participant's hidden grants, hidden active field, hidden cursor, hidden set
activity, or a cursor/count gap from hidden-field traffic. A participant with
no remaining shared readable field disappears from that recipient's roster
without a final awareness frame.

Awareness is optional, schema-validated, session-scoped, ephemeral,
latest-wins, and read-authorized in both directions. It is never an update,
snapshot, projection, checkpoint, audit event, or diagnostic payload. Defaults
are 1 KiB, 20 writes/second, 10-second heartbeat, and 30-second expiry.

Awareness may identify one manifest field as `activeField`. Text offsets are
accepted only when that field is readable and use UTF-16 scalar boundaries in
the sender's current replica. The text engine translates them to private
relative positions and back to local offsets for authorized receivers; no
engine bytes enter the public schema. Set fields have no cursor/selection
semantics. These remain ephemeral hints, not durable anchors. Durable
anchors/comments are a separate future capability.

### CD-15 — Safe errors and observability

Public codes are closed and disclosure-safe:

- `CRDT_UNAVAILABLE`;
- `CRDT_EDIT_NOT_ALLOWED`;
- `CRDT_RATE_LIMITED`;
- `CRDT_PROTOCOL_REJECTED`;
- `CRDT_RECOVERY_REQUIRED`;
- `CRDT_TRANSPORT_UNAVAILABLE`.

Unknown owner/record/field slot, hidden field, resolver null, read denial, and invalid/expired/used/
wrong-origin/wrong-principal ticket are externally indistinguishable as
`CRDT_UNAVAILABLE`. More detail is available only after read authority.
Responses contain stable code, retryability, optional bounded retry-after, and
opaque correlation id. Provider, SQL, policy, and adapter exception text never
reaches clients.

Metrics use bounded enums and numeric measurements only: phase, outcome,
engine/transport registry id, requested mode/grant bucket, frame/size/duration bucket, queue depth,
sync/projection lag, lease conflict, and close reason. Never log or label
aggregate/resource/record ids or hashes, ticket/credential/update ids,
principal/profile/awareness, sync proofs, snapshots, updates, canonical text,
or authorization error messages. Observer failure is non-fatal.

### CD-16 — Packaging, codegen, runtime, and migrations

Minimal package placement:

- generic builder, kernel, generated server/client types, protocol, and host
  transport contracts live in existing `questpie` under `questpie/crdt`;
- one new `@questpie/crdt-yjs` package contains only qualified `/server` and
  `/client` text-engine implementations and no UI bindings;
- no collaboration UI, Tiptap, Hocuspocus, Markdown, or provider package.

`.crdt()` is a core `Field` strategy annotation, not the current plugin
field-extension mechanism. It returns a type-state marker for exact text or set
semantics and stores normalized runtime metadata in field state.
`.collaborative()` is a core collection/global owner capability carrying
awareness and owner policy. Every refinement must preserve the field marker
when eligible regardless of call order; ineligible orderings, orphan markers
and empty owners fail closed. Collection/global runtime state is the registry;
codegen derives one aggregate plus typed field ports from it. There is no
discovered category, plugin module or duplicate registry.

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

1. explicit owner/orphan/empty-owner checks; no-awareness default, replacement
   and existing other-wins merge-order rules; text/set eligibility and marker
   call-order matrix; runtime aggregate registry; deterministic
   collection/global codegen; exact typed client/server ports including
   per-field authority targets/revoke, stable Human/Agent authority subjects,
   literal field status formats, full aggregate replace CAS and no partial/empty
   aggregate replace; phantom/non-CRDT rejection;
2. create rollback/seed, existing/global activation-vs-CRUD race, every ordinary
   mutation-path reject, unrelated CRUD, delete-vs-append/project,
   soft-delete/ordinary-undelete reject, restore same incarnation/new epoch,
   hard-delete/recreate new incarnation, namespace mismatch and rename mapping;
3. Human/OAuth-Human/verified-Agent/system isolation, mandatory scopes,
   row/AccessWhere over a current multi-field CRDT overlay while SQL projection
   is stale, overlay `(stableFieldId, fieldEpoch, fieldCursor)` CAS retry
   including equal-cursor field reset, patch-dependent fail-closed edit,
   browser Origin canonicalization/missing/null/spoof cases, cookie-free Agent
   flow, fresh context;
4. binary aggregate-bundle golden vectors including nonempty grant/revoke/reset
   transitions on Node/Bun plus fuzzing of
   major/minor/opcode, sorted/duplicate/unknown slots, field epochs/cursors,
   direction/state, flags, lengths, sequence/request id, trailing bytes,
   fragmentation and compression rejection;
5. 100-way ticket redemption with one winner, indistinguishable failures,
   custom base/path, client namespace mismatch and offline locator binding;
6. viewer/hidden-field update rejection; explicit mixed view/edit grants and
   zero-edit fallback behavior; selective read transfers no hidden snapshot,
   bytes or cursor gaps; unauthorized one-part mixed bundle rejects atomically;
   ACL/aggregate deadlock oracle; revoke-vs-append in both orders; typed
   owner/field authority targets and sorted multi-aggregate revoke; field read
   revoke during sync purges in-memory/offline bytes and makes
   `value/values/has` fail immediately; same-schema new-read/reset field-sync
   preserves unrelated replicas, handles revoke and a racing commit; no
   post-fence commit; commit→lost ACK→edit
   revoke→read-authorized receipt reconciliation with wrong
   subject/submitted-hash/resource/epoch/submitted-schema and hidden-part
   nondisclosure, including compatible old-queue replay after manifest change;
7. 50+ real PostgreSQL contending single/multi-field appends proving aggregate
   commit order, gap-free per-field cursors, rollback, atomicity, idempotent ACK
   retry and bigint safety;
8. flow-controlled 4/16/32 MiB sync and commit injection at every
   chunk/ACK/register/drain boundary proving no gap or queue overflow;
9. router characterization/extraction, one physical lifecycle, subscriber
   isolation, dropped/duplicated/reordered wakes, reconnect drain, two nodes;
10. Yjs text convergence, atomic op-list, emoji/ZWJ/combining/RTL, invalid
    scalar boundary/NUL/surrogate and one-root enforcement; add-wins set
    duplicate/reordered delivery, observed remove vs concurrent add, canonical
    equality/order; three-client title+tags+content offline convergence;
11. stale-basis retry, two-node combined boundary crossing, struct/delete/
    missing-dependency bombs, CPU/RSS/ArrayBuffer attacks in the worker;
12. bounded admission, every queue limit, slow consumer, reconnect recovery;
13. whole-manifest compaction crash matrix, no partial-field snapshot publish,
    corrupt-current fallback, receipt/retired-field-epoch/control-barrier
    preservation, never-reused schema versions, persisted/expiring
    compatibility maps, zero-session GC and offline recovery horizon;
14. aggregate-cut N/M projector inversion, multi-field atomic SQL projection,
    set add/delete convergence, field replace preserving unrelated queues,
    old-projector→replace→late stale no-op, exact five-second
    non-starvation, unrelated CRUD, canonical conflict, full aggregate and
    field replace crash atomicity, reset barrier not skipping older unrelated
    projection, exactly one idempotent `crdt_replace` owner change with no
    duplicate projector emission for the reset field, exactly one
    `crdt_projection` change for fields actually projected, and no hooks/version
    recursion or LWW overwrite;
15. multi-tab/device grouping, recipient-filtered roster/awareness intersection,
    hidden-field participant/activity nondisclosure, awareness
    spoof/rate/expiry/no durable leakage;
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
- no client path/slot claim substitutes for engine-derived touched bindings;
- no hidden field snapshot, update, cursor gap, receipt or awareness disclosure;
- no partial commit, receipt or projection of a mixed-field transaction;
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

- `concepts/collaborative-aggregates`, `server/crdt-strategies`, `client/crdt`,
  `production/crdt-host-support`, and `guides/collaborative-records`, with every
  containing `meta.json` updated;
- architecture coverage for owner/field boundaries, selective field access,
  aggregate commits, canonical projection and reuse boundaries plus exact
  generated client/server API reference;
- authorization/revocation guide for authentication principals and Human/Agent
  authority actors;
- offline/recovery, compaction/retention, observability, security, production
  host/runtime support, and troubleshooting docs;
- a generic headless collection/global recipe with concurrent title text, tag
  set and content text, demonstrating aggregate transactions, CRUD rejection,
  explicit replace, offline field/aggregate epoch recovery and no editor;
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

1. Lucia, Marek and an Agent open one collaborative `articles` record.
2. Each receives only authorized typed field replicas and one aggregate roster.
3. Lucia edits title text, Marek adds/removes tags, and the Agent edits content;
   same-field concurrent text and set operations also converge.
4. One client submits an atomic title+tags+content transaction; any denied part
   rejects the whole bundle.
5. Speculative changes are pending; remote visibility and ACK follow one
   authorized durable aggregate commit.
6. Marek goes offline, reloads, edits, reconnects and converges.
7. Field edit revocation prevents its next update; field read revocation leaks
   no state/cursor while other authorized fields may remain connected.
8. A stale aggregate/field epoch, schema manifest or retired incarnation cannot
   commit.
9. Projection updates every touched canonical field atomically with CAS
   protection and one normal realtime change.
10. Whole-aggregate compaction and restart preserve convergence, receipts and
    offline idempotency.

## Consolidated implementation graph

The Agent Board graph mirrors these dependency edges:

- **T0 Contract and adversarial closure** — ratify this document, state machine,
  protocol, limits, scenarios, and negative oracles.
- **T0b Aggregate amendment** — re-ratify record/global ownership, text/set
  strategies, selective field access, atomic bundles and schema manifests;
  blocks T2b, T3a and T5a.
- **T1a Baseline characterization** — one broker lifecycle, current realtime
  reconnect/shutdown, access/field type preservation, PG15 preflight; depends
  on T0.
- **T1b Shared infrastructure** — multicast router, bounded queues/semaphore,
  fresh-context plus additive actor seam; depends on T1a.
- **T2a Field type-state/eligibility** — initial text marker baseline; amended
  by T0b/T2b to add explicit owner state and text/set strategy matrices.
- **T2b Registry/codegen/identity guards** — marker-derived registry, generated
  aggregate/typed-field API, stable manifest identity and ordinary CRUD guards;
  depends on T2a and T0b.
- **T3a Protocol/host contract** — pure wire parser/golden vectors and Elysia
  mount contract; depends on T0 and T0b.
- **T4a Generated durable schema/stores** — aggregate header/commit,
  bindings/field parts, snapshot manifests, receipts, tickets, sessions,
  admission, projection and leases; depends on T2b.
- **T5a Generic engine seam/fake** — aggregate coordinator, UTF-16 text and
  observed-remove add-wins set replicas, staged bundles and deterministic fake;
  depends on T2a and T0b.
- **T5b Qualified Yjs engine** — server/client package, worker bounds,
  text convergence plus qualified core set engine; depends on T5a.
- **T2c Persisted owner lifecycle** — singleton namespace verification,
  resource/incarnation/binding create and lazy activation, add-field,
  delete/restore/recreate; depends on T2b, T4a, and T5a.
- **T3b Ticket/admission/host** — issue, redemption, global caps and real Elysia
  upgrade; depends on T1b, T2c, T3a, T4a.
- **T4b Atomic append/fencing** — staged multi-field CAS, atomic receipt,
  aggregate commit/per-field cursor ordering and post-commit wake; depends on
  T1b, T2c, T4a, T5a, then qualifies with T5b.
- **T6 Sync/HA** — flow-controlled bootstrap, router drain, polling, reconnect;
  depends on T1b, T3b, T4b, T5b.
- **T8 Projection/compaction/replace** — atomic aggregate-cut projector,
  complete snapshot manifests, retention, GC and aggregate/field epochs;
  depends on T2c, T4b, T5b and integrates with T6.
- **T7 Client/offline/awareness** — inert aggregate handle, typed fields,
  transactions, SSR, offline recovery and roster/awareness; depends on T2b,
  T3a, T5b, T6 and T8.
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
