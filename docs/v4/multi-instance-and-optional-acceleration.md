# Multi-instance correctness and optional acceleration

ADR-0017 makes ten-instance high availability the normal correctness model,
not a later enterprise mode. PostgreSQL remains the only hard durable
dependency. Memory, Redis/KV, and notification brokers may
save work or latency; losing all of them cannot change authority or results.

## One authority model across the fleet

Every compatible Runtime instance can accept roots, reconcile Change Ledger
facts, accept schedule ticks, claim durable work, and resume clients. PostgreSQL
owns all facts that survive an instance:

| Concern          | Durable owner                                        | Instance-local state                   |
| ---------------- | ---------------------------------------------------- | -------------------------------------- |
| Operation replay | PostgreSQL result receipt                            | response buffer                        |
| Live Query       | Change Ledger and exclusive visibility frontier      | SSE connection and bounded send buffer |
| Job/Reaction     | run, attempt, lease, timer, signal, and history rows | current handler and Services           |
| durable schedule | unique schedule/tick acceptance                      | scan opportunity                       |
| Query cache      | dependency generations and fresh Policy              | Memory/Redis value bytes               |

No process is an application, scheduler, queue, or realtime singleton. An
instance crash loses local connections, buffers, Services, cache values, and
wake hints. Clients reconnect anywhere; expired work is reclaimed with a new
fenced attempt.

## Cache without a second data API

Query caching is a compiler/Runtime projection. Application handlers do not
receive raw Memory or Redis/KV access.

An entry binds the exact application/build, Query, canonical input, output
codec, authority partition, observed dependency generations, and expiry. A
fresh root Execution and current Policy precede disclosure. A miss, stale
generation, corrupt value, timeout, or unavailable store recomputes or resets.
The handler cannot observe whether the answer came from Memory, Redis, or a
fresh Query and cannot make a business decision from the backend.

Memory and Redis are enough to prove one narrow byte-store capability. Adding a
third cache does not create another public provider contract.

## Wakes announce possible progress

`LISTEN`/`NOTIFY`, Redis pub/sub, or another broker can announce a ledger shard
or durable class that may have advanced. The message is never a committed
change, authorized output, or run receipt. Duplicate, coalesced,
reordered, delayed, and absent hints all converge through PostgreSQL scans.

Startup and listener reconnect establish the listener, reconcile durable state,
then process overlapping hints. A broker outage increases scan latency; it
cannot lose a Live Query refresh, Job, or schedule tick.

## Realtime without affinity

The v1 physical transport is one bounded multiplexed SSE downstream per client
scope plus Fetch/POST upstream. One SSE connection can carry several Live Query
bindings. The connection and its backpressure buffer are local, but neither is
durable authority.

An upstream request or Mutation may route to a different compatible instance.
When SSE disconnects, the generated client reconnects anywhere with its opaque
token. PostgreSQL-bound retained state either resumes safely or causes a fresh
authorized reset. Sticky routing may reduce churn; correctness never needs it.

## Transient application events stay outside the Runtime

Typing state, cursors, advisory presence, progress, and similar transient
signals are ordinary application/provider integrations. They have no QUESTPIE
Resource, generated client, PostgreSQL event ledger, replay contract, presence
model, or runtime carrier binding. Provider authentication and connection state
cannot decide Policy or authorize an Operation.

When an external publish attempt must survive commit, Reaction or Job owns the
durable acceptance and attempts and crosses an Action or external-effect
Service boundary. Physical attempts remain at least once and provider delivery
may remain ambiguous. Durable business history is ordinary persisted data.

## Rolling deployment

Compatibility is not one coarse build equality. Schema, wire, Policy/Context,
realtime, executable, and internal protocol remain separate decisions. A
Runtime claims only work whose pinned executable it carries. Old and new
compatible builds can overlap, but a retained Resume Token or nonterminal run
can block retiring bytes it still needs.

## Evidence

The exact repaired reviewed proof head is
`039a720d12956ddc8e1a310e287945de35a52065`; acceptance evidence is recorded at
`96829bd7b08ea54e60fdc7d5b077366235d2dfea`. The initial clean review head
`be611ef244687be9daccc2a9e02fbd2e2ccfe86e` received a valid `BLOCKED` verdict;
the repair replaced tautological rolling evidence, sequential workers, and
hard-coded upstream/parity results. One replacement fresh stateless Claude Opus
review at medium effort returned `PASS`.

The repaired proof covers ten instances, three-instance SSE/POST/resume,
complete cache/wake loss, fresh Policy revocation, concurrent scheduler and
`SKIP LOCKED` worker sessions, crash recovery and stale fencing, old/new build
refusal/claim/retirement, and distinct direct, worker, recompute, and Studio
adapters. Isolated PostgreSQL 17.10 passes with only B-tree indexes and zero RLS
objects; no RLS claim is made. The historical Channel proof is superseded by
ADR-0025 and is not an implementation requirement.
