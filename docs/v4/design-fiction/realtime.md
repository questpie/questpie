---
title: Watch Queries in realtime
description: Subscribe to the same authorized Query, recover after disconnects, and understand exactly what QUESTPIE observes.
status: promoted-after-P4-acceptance
implementation-status: unimplemented
accepted-contracts:
  - the same generated named Query method owns one-shot calls and watch
  - immutable Context-scoped generated clients
  - TanStack-neutral callback watch with abort and unsubscribe
  - complete-result initial, update, and reset deliveries
  - opaque client-managed resume token and explicit fresh-snapshot reset
  - actual-read dependency observation and successful-plan replacement
  - fresh Context Resolution and Policy on every recomputation
  - transactionally captured PostgreSQL Change Ledger
  - LISTEN and NOTIFY as lossy wake only
  - latest-result coalescing and bounded slow-consumer handling
  - independent Query snapshot consistency without atomic multi-Query publication
  - deployment-digest invalidation
  - trigger capture for supported raw SQL, cascades, and external writers
accepted-proof-head: 05fc96f3d07c70beaf7f654d79d6cfb46f427f92
public-projection: ../../../apps/docs/content/docs/v4/realtime.mdx
---

# Watch Queries in realtime

A Live Query is the authorized result of an ordinary Query kept current. You
define the Query once, call it once when you need one result, and call
`.watch(...)` on that same generated method when the result should continue to
arrive.

There is no second realtime handler, client-authored database query, channel
name, invalidation list, or manual refetch loop.

## Define one Query and watch it

The server owns the Message page as one named Query:

```ts title="src/features/message-page.ts"
import { defineQuery } from "#questpie/app";
import { operation, policy } from "questpie";
import { messagePageData } from "./message-data";

export const messagePage = defineQuery({
	name: "messages.page",
	input: operation.input(messagePageData),
	policy: policy.authenticated(),
	handler: async ({ input, ctx }) => ctx.data.run(messagePageData, input),
	network: true,
});
```

`messagePageData` is the structural data plan from the data chapter. It owns
the exact Message selection, Channel filter, total order and forward cursor
page. The attached Collection Policy owns the relational membership rules.

The browser uses one generated, immutable company scope:

```ts title="web/live-messages.ts"
import { createClient } from "#questpie/client";

const client = createClient({
	baseUrl: "http://localhost:4000",
	credentials: "include",
});

const company = client.withContext({
	companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
});

const input = {
	channelId: "018f6094-cf3c-70e9-8d68-80d523f14c19",
	first: 20,
	after: null,
} as const;

// One current authorized result.
const firstPage = await company.queries["messages.page"](input);
console.log(firstPage.nodes);

// The same Query kept current.
const stop = company.queries["messages.page"].watch(
	input,
	(page, delivery) => {
		// Every delivery is the complete current Query result. Replace old state.
		console.log(page.nodes);

		if (delivery.kind === "reset") {
			console.info("Realtime resumed with a fresh snapshot", delivery.reason);
		}
	},
	{
		onStateChange: (state) => {
			if (state.kind === "reconnecting") {
				console.info("Showing the last result while QUESTPIE reconnects");
			}
		},
		onError: (error) => {
			console.error("The watch ended", error);
		},
	},
);

// Later, when the screen no longer needs the result.
stop();
```

The first callback delivery is the initial result, so an application does not
normally make the one-shot call before it watches. Both calls are shown to make
the API ownership explicit: `.watch` belongs to the exact same generated
`messages.page` method.

The callback's `page` has the same generated type as `firstPage`. The second
argument explains how that complete value arrived:

```ts
type QueryDelivery =
	| { kind: "initial" }
	| { kind: "update" }
	| {
			kind: "reset";
			reason: "resume-unavailable" | "deployment-changed" | "authority-changed";
	  };
```

This union illustrates the generated client contract; application code does
not declare it. An `initial`, `update`, or `reset` value is always a complete
Query result and always replaces the previous value. A reset is not a patch and
does not require the application to merge Change Ledger entries.

`watch` returns the familiar unsubscribe function. An `AbortSignal` is
equivalent when a component or task already owns one:

```ts title="web/live-messages-with-abort.ts"
import { createClient } from "#questpie/client";

const client = createClient({
	baseUrl: "http://localhost:4000",
	credentials: "include",
});

const company = client.withContext({
	companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
});

const controller = new AbortController();

company.queries["messages.page"].watch(
	{
		channelId: "018f6094-cf3c-70e9-8d68-80d523f14c19",
		first: 20,
		after: null,
	},
	(page) => console.log(page.nodes),
	{
		signal: controller.signal,
		onError: (error) => console.error(error),
	},
);

controller.abort();
```

Abort is a normal local close and does not call `onError`. A terminal Policy,
version, protocol, resource-limit, output-validation, or transport failure does.
Retryable connection loss is reported through `onStateChange`; the generated
client owns reconnect and does not ask application code to rebuild the watch.

## Where every type comes from

No realtime callback depends on an ambient registry or a manually repeated
result interface:

| Code                          | Exact contextual type source                                |
| ----------------------------- | ----------------------------------------------------------- |
| `messagePage` handler `input` | `operation.input(messagePageData)` in the same Definition   |
| handler `ctx`                 | the generated App Contract narrowed to read-only Query mode |
| `ctx.data.run` result         | the exact selection and page contract of `messagePageData`  |
| `client.withContext` input    | the compiled application Context input                      |
| generated Query member        | the compiled, network-exposed `messages.page` contract      |
| `.watch` input                | the same exact input as the one-shot Query call             |
| callback `page`               | the same exact decoded output as the one-shot Query call    |
| callback `delivery`           | the generated Query-delivery union                          |
| `onStateChange` state         | the generated base-client watch lifecycle union             |
| `onError` error               | framework watch failures plus the Query's declared errors   |

An unknown Context key, Query name, input key, Field, or delivery kind fails in
the editor. A server-only Query has no browser member. A Query whose reads or
output cannot satisfy the Live Query contract remains callable once but has no
usable `.watch` contract; the compiler reports the unsupported dependency at
its source Origin.

The base API is deliberately independent of React, TanStack Query, or another
cache library. An integration adapts this `watch` lifecycle into that library's
cache and cleanup rules. It does not create another subscription protocol or
authorization path.

## What a watched Query observes

The compiler knows the Query's declared structural reads, but the Runtime
records the supported reads that each execution actually performs. The
dependency plan includes more than the rows returned to the client:

- selected, filtered and ordered Collection Fields;
- point keys, unique lookups, empty matches, ranges and page boundaries;
- the complete cursor order, `first + 1` sentinel and whether it existed;
- Relation endpoints and join keys, even when no related row matched;
- relational Policy evidence such as Company and Channel membership;
- database reads performed during Context Resolution;
- nested Query and supported generated Collection reads that the executed
  branch actually reached.

An empty result still has dependencies. If the page currently contains no
Messages, inserting the first matching Message must invalidate it. If a new
Message sorts before the current page boundary, the page must recompute even
though that row did not exist in the previous result.

Conditional handler code produces conditional dependencies. A branch that
reads Collection A records A; another branch that reads A and B records both.
After a successful recomputation, QUESTPIE atomically replaces the previous
plan with the new one. It does not union every historical dependency forever.
A failed or cancelled recomputation keeps the last successful plan and never
publishes a partial result.

Static call-site scanning cannot provide these guarantees. It misses branches,
helper calls, empty ranges, Policy evidence, pagination sentinels and the reads
of nested operations. Runtime observation is therefore part of Query execution,
not a second author-maintained `watch` list.

## Recompute under fresh authority

A socket connection and an earlier Policy decision are never authority for a
later result. Every recomputation constructs a fresh Execution for the same
typed Context input, refreshes the Principal according to the Auth contract,
runs Context Resolution, opens one Query snapshot, and evaluates admission,
row, Relation and output-Field Policy again.

For the Message page, a change to any of these facts can matter:

- the Message rows and their ordering Fields;
- the Channel or Space that relates them to the selected Company;
- Company or private-Channel membership;
- a role, ban, visibility or ownership Field read by Policy;
- the Context Resolver's active-membership lookup;
- the deployed Policy or Context Resolver itself.

Revoking membership therefore invalidates the watch even if no Message changed.
The next execution may publish a smaller or empty authorized result, return the
Query's nondisclosing error, or terminate when Context Resolution can no longer
construct the selected company Execution. It cannot continue to publish bytes
under the historic allow decision.

Already delivered bytes cannot be retracted from application memory. During a
network partition, `onStateChange` lets a security-sensitive screen hide its
last result instead of showing stale state. On reconnect, QUESTPIE authorizes
before it publishes another value.

Equivalent watches may share computation only when Query identity, executable
and output versions, normalized input, resolved Context, Principal/Tenant/
Authority fingerprint, and every other result-affecting dimension are
equivalent. Sharing is an optimization, never an authorization shortcut.

## How committed changes wake a Query

Reactive Collections install compiler-owned PostgreSQL capture. A supported
write produces a durable Change Ledger fact inside the same transaction as the
business change:

```text
PostgreSQL transaction
  update business rows
  trigger records bounded change facts
  commit both or neither
                 |
                 v
durable Change Ledger
  reconcile facts against observed dependency plans
                 |
                 v
mark matching Queries dirty
  fresh Execution + Policy + Query snapshot
                 |
                 v
replace dependencies and publish the complete result
```

The ledger fact is invalidation evidence, not a client event and not a copy of
the authorized Query output. The Runtime can conservatively recompute when a
fact may overlap a dependency; only the fresh Query execution decides the
result.

PostgreSQL `LISTEN`/`NOTIFY` is a latency optimization over this durable path.
The notification says only that durable state may have advanced. It may be
duplicated, coalesced, delayed, reordered, or lost when a connection or process
dies. It carries no result, authorization decision, Context value, row payload,
or authoritative cursor.

Runtime startup and listener reconnect follow this order:

1. establish the PostgreSQL listener;
2. reconcile durable Change Ledger state;
3. process later wake hints while periodic reconciliation continues.

This order closes the listener setup race. A business transaction that commits
and then loses its notification is still found. If the Runtime process stops
after the database commit but before any wake, startup reconciliation still
marks the affected Query dirty and computes a fresh result.

Repeated invalidations may coalesce into one recomputation against a snapshot
new enough to include them. A Live Query synchronizes current state; it does
not promise one callback for every database transaction.

## Reconnect, resume, and reset

The generated client remembers the last server result it acknowledged for one
active watch. After a retryable disconnect it reconnects with an opaque resume
token. The server does exactly one of two things:

1. verify compatible retained state, reconcile durable changes, reauthorize,
   and continue the watch; or
2. reject continuation and publish a fresh authorized result whose delivery
   kind is `reset`.

A reset is normal recovery. It can happen because retained state expired, the
server cannot verify the checkpoint, the application deployment changed, or
the authority partition changed. The application replaces its old value with
the reset result and continues watching.

The token is managed by the generated client and intentionally opaque. It is
bound to the application deployment, Query and wire versions, normalized
input, authority partition and retained checkpoint generation. It is not a
Change Ledger row id, timestamp, PostgreSQL transaction id, sequence value, or
LSN. Application code does not compare it, decode it, use it as a page cursor,
or infer database ordering from it.

An in-memory watch can resume its own connection. A new browser process or a
new watch without retained client state starts with a fresh initial result.
Persistent offline resume needs a separate storage and compatibility contract;
the base API does not silently persist authorization-bearing state.

### Why the internal frontier uses PostgreSQL visibility

A trigger-time `bigserial`, timestamp, or transaction identifier is not by
itself a commit-safe high-water mark. One transaction can allocate a lower
value, remain open, and commit after a transaction with a higher value. A
reconciler that stores only `max(id)` can then skip the late commit forever.

QUESTPIE does not expose a ledger cursor. Reconciliation persists an exclusive
`xid8` PostgreSQL visibility horizon, processes visible facts below the next
snapshot horizon, and advances the consumer horizon atomically with processed
effects. Concurrent out-of-order commit, rollback, retention, sequence wrap,
and absent-wake proofs passed. The public behavior needs only an opaque
continuation attempt and a safe reset when continuation cannot be proven.

## Complete results, not event patches

Every callback receives the complete current Query result. QUESTPIE may avoid
sending byte-identical results, but it does not expose database row changes or
Change Ledger facts as if they were the Query's authorized output.

Complete recomputation preserves semantics that row events cannot safely
reconstruct in a browser:

- relational and output-Field Policy;
- sorted and paginated membership;
- inserted rows crossing a page boundary;
- counts and `hasNextPage` sentinels;
- application computation across several Collections;
- Context or membership revocation;
- server-code and serializer changes.

Transient provider signals, durable application event streams, and
collaborative documents are different jobs. They do not replace a Live Query
or become another QUESTPIE realtime Resource. Provider signals are composed by
application code and do not share Live Query's latest-result delivery rules.

## Slow consumers and hot data

Live Query delivery is latest-state synchronization. If ten relevant commits
arrive while one recomputation is running, QUESTPIE may mark the watch dirty
once and run again after the current execution. It never needs ten concurrent
executions of the same version.

If a client cannot consume complete results quickly enough, one pending older
result may be replaced by the newest result for that Query. Intermediate
results are not an event log. The Runtime still preserves durable ledger
reconciliation; dropping an obsolete outbound snapshot does not advance past
unreconciled database work.

Every deployment has finite limits for:

| Budget                                   | Behavior when reached                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| Query duration, rows, and bytes read     | fail that execution with a bounded diagnostic                                       |
| dependency count and range complexity    | reject the watch rather than silently omit a dependency                             |
| active watches per session and Principal | reject new watches with a resource-limit error                                      |
| equivalent shared groups and fanout      | schedule bounded batches and expose lag                                             |
| dirty recomputation queue and rate       | coalesce current-state work without concurrent duplicate runs                       |
| result and outbound buffered bytes       | reset or disconnect the slow client before memory grows without bound               |
| resume-token count and retention age     | expire continuation and deliver a fresh reset result                                |
| Change Ledger bytes and unreconciled age | fail readiness, surface lag, and apply the configured admission/backpressure policy |
| PostgreSQL notification queue health     | report degraded wake latency while reconciliation remains authoritative             |

A result larger than the single-result cap is a terminal error for that watch;
it is not truncated into a value that violates the Query output contract. A
slow connection is closed before an unbounded buffer forms. Reconnect then
resumes when provable or receives a fresh reset.

The accepted defaults are 64 active watches per Principal, 256 dependencies,
1,048,576 result bytes, 2,097,152 buffered bytes, 1,024 watches per fanout
batch, 30,000 ms ledger lag, 128 retained tokens per Principal, and 86,400,000
ms token retention. The Runtime, CLI and Studio must report deployed values and
the specific limit that ended or delayed a watch.

## Consistency is exact for one Query, independent across Queries

One recomputation runs the complete named Query in one Query-owned PostgreSQL
snapshot. All supported Collection reads, structural plans, Context database
reads that belong to that snapshot, and Policy evidence for that execution see
the Query's defined consistent view. The Runtime publishes only the complete,
validated result and its successfully replaced dependency plan.

Several independent watches do **not** form one atomic client transaction in
the first contract:

```ts title="web/independent-watches.ts"
import { createClient } from "#questpie/client";

const client = createClient({
	baseUrl: "http://localhost:4000",
	credentials: "include",
});

const company = client.withContext({
	companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
});

const stopMessages = company.queries["messages.page"].watch(
	{
		channelId: "018f6094-cf3c-70e9-8d68-80d523f14c19",
		first: 20,
		after: null,
	},
	(page) => console.log(page.nodes.length),
);

const stopSidebar = company.queries["navigation.sidebar"].watch({}, (sidebar) =>
	console.log(sidebar.unreadCount),
);

stopMessages();
stopSidebar();
```

Each result is internally snapshot-consistent and each watch converges after
relevant commits, but `messages.page` may publish before `navigation.sidebar`.
The two callback values must not be presented as one shared database instant.

When a screen requires an atomic view of Messages, membership, Channel state
and counters, define one composite Query that reads and returns them together,
then watch that Query. Atomic publication across several independent Query
Resources would require a retained shared snapshot and an atomic client batch;
QUESTPIE does not imply that stronger and more expensive contract.

## Deployment changes invalidate old observation

A dependency plan is valid only for the exact compiled application that
produced it. Query executable code, Policy, Context Resolution, Data Contract,
output codec and serialization all affect its meaning.

The Runtime binds each watch to the relevant deployment digests. A deployment
never runs new code against an old dependency plan. Compatible rolling change
still recomputes and re-observes dependencies. When retained continuation or
the wire result is not compatible, the generated client receives a reset or a
typed version failure instead of decoding new bytes as the old type.

Old browser clients still need the Operation evolution rules of the generated
wire contract. Realtime reset does not make a breaking output change backward
compatible.

## Raw SQL, cascades, and external PostgreSQL writers

Change capture belongs to the database transaction, not only to
`ctx.data.*`. Compiler-installed capture on a reactive Collection is intended
to cover all supported writers to that instrumented table:

| Write path                                                                                             | Realtime contract                                                             |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| QUESTPIE Mutation or Collection operation                                                              | captured in the business transaction                                          |
| parameterized raw SQL through a supported application role                                             | captured by the same database trigger                                         |
| foreign-key cascade into an instrumented table                                                         | the affected table's capture runs                                             |
| supported `COPY`, bulk update, conflict update, merge, or truncate                                     | captured according to its proven bounded trigger plan                         |
| external PostgreSQL client using the managed schema and supported role                                 | captured without using the QUESTPIE client                                    |
| superuser, trigger-disabled session, replication-role bypass, dropped trigger, or uninstrumented table | outside the guarantee and detected where deployment conformance can detect it |

The migration and Schema Fingerprint own the trigger functions, attachments,
enable mode, partitions and grants. Drift verification must fail when that
surface changes. “External writer support” does not mean an unrestricted role
may disable or replace the mechanism and retain realtime guarantees.

Bulk and cascade behavior must be tested for bounded ledger volume and correct
invalidation. A capture implementation may record a conservative table or
range fact instead of serializing every changed row, provided it cannot miss a
matching dependency.

Raw **reads** are a separate problem. QUESTPIE cannot infer the tables, ranges,
Policy evidence or pagination boundaries of arbitrary SQL text. A future named
native statement must carry a closed, compiler-checked dependency contract. If
the observer cannot prove that declaration complete, the Query may run once but
cannot be watched. No `unsafe`, `raw`, `skipPolicy`, or “invalidate everything
later” boolean silently turns an unknown read into a Live Query.

## What QUESTPIE generates and operates

The compiler and Runtime keep the happy path small by owning the machinery
behind `.watch`:

- the Query's exact watchable input, output, error and Context types;
- declared structural dependency templates and Origins;
- runtime observation slots for generated Collection, Relation, Policy,
  Context and nested Query reads;
- deployment and authority partition identities;
- versioned protocol frames, acknowledgement and opaque resume tokens;
- trigger-based Change Ledger schema and drift evidence;
- bounded dependency matching, dirty scheduling and result delivery;
- one transport-neutral generated client lifecycle used by adapters;
- Execution Envelope events for subscription state and failures.

Studio can inspect Query identity and deployment digest, Context and authority
partition identifiers without secrets, dependency kinds and counts, last
successful recomputation, reset reason, listener and reconciliation health,
lag, buffered bytes and the exact budget that failed. It cannot treat an old
dependency plan as current authorization or expose protected Policy evidence.

The application author still sees one Query Definition and one generated
method. That familiar surface is possible because v4 gives observation,
authorization, transaction capture, recovery and limits explicit owners instead
of hiding them in a transport-specific `live` route.

## Know the guarantee

For one supported watched Query, QUESTPIE promises:

1. the first delivery is one complete current authorized Query result;
2. supported actual reads, including Policy and Context evidence, determine
   invalidation and are replaced after each successful recomputation;
3. relevant committed writes survive lost wakes and Runtime crashes through
   durable reconciliation;
4. every later result runs under fresh authorization and one Query snapshot;
5. reconnect either resumes safely or replaces state with an explicit fresh
   reset result;
6. slow consumers and hot changes remain bounded and may skip intermediate
   complete results, never fabricate partial state;
7. independent Queries converge independently and are not one atomic batch;
8. unsupported raw dependencies and unsupported database roles are rejected or
   documented outside the guarantee.

P4 proof head `05fc96f3d07c70beaf7f654d79d6cfb46f427f92` passed the
concurrent-commit, revocation, reconnect/reset, raw-writer, retention, fanout,
and slow-consumer fixtures. The finished public projection is
`apps/docs/content/docs/v4/realtime.mdx`; this page remains internal reader
journey evidence.
