# HANDOFF — QUESTPIE Realtime v3 (deltas) + `@questpie/tanstack-db`

Prepared for a coding agent (codex) to **finish designing the open items, implement, and verify**.
Branch: **`drepkovsky/realtime-v3-tanstack-db`**. Work in your own git worktree off this branch.

This plan was produced by a research pass and hardened by an adversarial design review. The
review verified its findings against the real code — the **MUST-FIX** items in §8 are confirmed
soundness bugs, not opinions. Treat §1–§5 as **FROZEN** (do not relitigate), §8 as hard
constraints, and §9 as the design work you own.

---

## 0. Your mandate & how to work

Per track: **(1) DONAVRHNI** the open design items (§9) within the frozen constraints →
**(2) IMPLEMENT** → **(3) VERIFY** (write/extend the acceptance tests in §11; run an
implement + adversarial-review loop before calling a track done).

- Small, reviewable commits. Every changed line traces to a task id (§7) or a must-fix (§8).
- **Do NOT touch** the broker adapters (PgNotify/Redis/Pusher), HA topology-coordinator, or
  poll-reconcile. They stay UNCHANGED (§4). The change *source* and *delivery* are decoupled
  from the broker by design.
- Typecheck a package: `bunx tsc --noEmit -p packages/<pkg>/tsconfig.json`. Lint: oxlint/oxfmt.
- Ship order: the delta-server **emitter is on HOLD** until its soundness items (§8, §9) are
  designed & specced. The other three tracks are unblocked and start now (§6).

---

## 1. Goal & paradigms — FROZEN

Additive delta-based realtime + a new opt-in package. **The existing full-snapshot realtime
path is KEPT** (nothing is removed or deprecated).

- **P1 (existing):** `@questpie/tanstack-query` + `{realtime:true}` — simple query+realtime.
- **P2 (new):** `@questpie/tanstack-db` — local-first store (collections, live-queries, joins,
  built-in optimism).
- Goal: remove the **O(n)-per-change** snapshot cliff (send O(Δ), not the whole result set every
  change) and enable local-first. Driver: Autopilot V2 (already on P1) + eventual admin.

---

## 2. Locked architecture — FROZEN

- **Single wire union** (see §5) shared by client + server. Client field names are authoritative;
  server matches field-for-field. Use `row` (NOT `value`).
- **Client-differ-first decoupling.** tanstack-query + tanstack-db v1 ship against **today's
  snapshot server** via a client-side differ (`deriveFindDeltas`). The server delta-emitter is a
  **drop-in upgrade of the delta SOURCE** feeding the identical client reducer — NOT a prerequisite.
- **Membership = DB-as-matcher.** No JS where-matcher. A changed row's membership is decided by a
  single-row `findOne` that reuses the exact `PRECHECKED_READ_ACCESS` read path
  (`topicWhere AND {id: recordId}`), so a delta row is byte-identical to a snapshot row. Non-null ⇒
  member+visible; null ⇒ non-member / access-filtered / deleted.
- **Delta eligibility = "shape-subset".** A topic is delta-eligible ONLY if it satisfies **two
  invariants**:
  1. **Signal completeness** — every membership-affecting change emits a base-collection outbox
     event keyed to a `recordId`.
  2. **O(1) computability** — the delta is computable from the single hydrated row without
     re-querying the whole set.
  Concretely: `collection.find`, **own-column** scalar/logical `where`, **no** `limit`/`offset`/
  `orderBy`/`with`/relation-`where`. Everything else (`count`, `get`, `groupBy`, aggregates,
  windowed/ordered/joined finds) → **snapshot mode** (always correct, re-runs the whole query).
  This is a correctness floor, not a policy. **You do not lose order/limit/join** — they move to
  the CLIENT (tanstack-db live-queries over the synced collection do them incrementally).
- **txid** (optimistic reconciliation): outbox column `DEFAULT pg_current_xact_id()` (xid8, stored
  as text), evaluated inside the mutation tx so `outbox.txid == mutation.txid`. Watermark =
  `pg_snapshot_xmin(pg_current_snapshot())` captured **strictly BEFORE** compute; client drops
  pending optimistic state only when `BigInt(upToDate) > BigInt(T)` or an exact per-delta
  `txid === T`. **Never** match on `seq` (statement-time, not commit-order). **PG13+ is a hard
  requirement** (add a fail-fast preflight).
- **Access = app architecture, NOT a new framework capability.** Write access rules **relationally
  through the membership collection** (e.g. `channels.read = { space: { in: <spaces where a
  membership row exists for :principalId> } }`), NOT materialized id-sets baked into context. The
  delta path **reuses** existing `PRECHECKED_READ_ACCESS` (per-row enforcement) + `watchedResources`
  (a membership change on the third collection triggers a targeted re-bootstrap). **Access-
  equivalence key = principal id.** Realtime context = **principal id + organization id only**;
  never expand sets (org spaces, memberships, …) into context — derive ad-hoc. This is documented
  doctrine + reuse of existing mechanisms; **build no new access machinery.**
- **UNCHANGED:** broker (PgNotify default / Redis / Pusher), HA topology (owner/lease + fencing),
  poll-reconcile safety net. Outbox = correctness, broker = latency.

---

## 3. Locked decisions — FROZEN

- **Delta enablement:** **OPT-IN per topic for v3.0.** The classifier still gates *eligibility*
  (only shape-subset topics can be delta), but even eligible topics stay snapshot unless the topic
  opts in. Flip to auto-classify **later**, once the acceptance suite + delta-server soundness fixes
  bake. Rationale: contain the blast radius of delta's real correctness surface on the first ship.
- **Access-staleness in delta mode:** **bounded periodic re-bootstrap + document the window**, PLUS
  `watchedResources`-triggered targeted re-bootstrap on a membership/access-relation change. **Defer**
  principal/claim-change session teardown. ds-9's access-change test targets this mechanism.
- **tanstack-db factory:** `createQuestpieCollections(client, { queryClient, syncMode?, ... })` —
  the caller supplies the QueryClient (single react-query identity). Default `syncMode: 'refetch'`;
  `'snapshot'` opt-in; `'delta'` later.

---

## 4. Conventions — FROZEN (the codebase enforces these)

- **Migrations are CLI-generated.** `bun questpie migrate:generate` produces `.ts` + snapshot; the
  new column auto-registers via `app.getSchema()`. **Never hand-write ALTER SQL.** Run
  `migrate:generate` **twice** and confirm the second run yields **no diff** (a volatile column
  default can cause a perpetual diff — if so, pin `.default(sql\`pg_current_xact_id()::text\`)`).
- **Package exports via tsdown + `src/exports/*`.** **Never hand-edit `package.json` exports**
  (tsdown overwrites on build). Mirror `packages/tanstack-query` exactly for the new package.
- **core == userland / declarative.** No hardcoded switch maps; the delivery classifier is a
  data-driven predicate, not a growing `if/switch`.
- **Surgical.** Touch only what a task requires; keep broker/HA/channels untouched.

---

## 5. The wire contract — FROZEN (single authority: client union in `stream.ts`)

Define once (task tq-1), export via `client/realtime/index.ts` → `client/index.ts` → `exports/client.ts`;
the server `RealtimeDeltaFrame` (ds-1) matches it field-for-field.

```ts
type RealtimeStreamEvent<TData = unknown> =
  | { type: 'snapshot';   topicId: string; seq: number; data: TData; reset?: boolean; upToDate?: string }
  | { type: 'insert';     topicId: string; seq: number; txid?: string; key: string; row: unknown; index?: number }
  | { type: 'update';     topicId: string; seq: number; txid?: string; key: string; row: unknown; index?: number }
  | { type: 'delete';     topicId: string; seq: number; txid?: string; key: string }
  | { type: 'up-to-date'; topicId: string; seq: number; txid?: string; upToDate?: string; meta?: { totalDocs?: number } }
```

Rules (must-fix-derived): `upToDate` MUST also ride the `up-to-date` frame (+ an idle heartbeat) so a
mutation whose row is not a member of any subscribed delta topic still resolves pending optimistic
txids. **seq is a resume cursor + FIFO order only — never a per-frame dedupe key** (bulk emits many
frames at one seq). Apply is idempotent by key (insert-on-existing-key = in-place replace); a fresh
`snapshot` (or `reset`) is an authoritative replace. Fix the existing latent bug where the client
drops the `reset` field (multiplexer.ts).

---

## 6. Tracks — go/no-go & sequencing

- **Wire (tq-1 / ds-1):** the real foundation. Lock the client union first; server matches.
- **tanstack-query-delta — GO now.** Decoupled via the client differ; works against today's server.
- **tanstack-db — GO now**, but **db-1 first RE-PINS versions** (see §8: NOT 0.5.x). Fully
  independent of delta/txid for v1 (`refetch`/`snapshot`).
- **txid — GO now** for tx-1..tx-7; tx-8/tx-9 sequence after ds-5.
- **delta-server emitter — HOLD.** ds-2 (ordered transport primitive) is safe to build now; the
  ds-5+ emitter must not ship until the §8 soundness items are designed & specced. Nothing else
  depends on it shipping, so this does not delay the other tracks.

---

## 7. Task graph (ids + deps; files cited inline)

**Shared wire**
- `tq-1` (no deps): `RealtimeStreamEvent<TData>` union + apply helpers (`applyRealtimeFindEvent/Scalar/Single`, `envelopeMeta`) in `client/realtime/stream.ts`; re-export through `realtime/index.ts` → `client/index.ts` → `exports/client.ts`.
- `ds-1` (dep tq-1): `realtime/delta.ts` — `RealtimeDeliveryMode`, `classifyRealtimeDelivery`, `whereReferencesRelations`, `deriveDeltaOp`, `RealtimeDeltaFrame` (byte-compatible with tq-1).

**tanstack-query-delta** (client differ path — no server dependency)
- `tq-2` (dep tq-1): change `RealtimeSubscriber` `(data)=>void` → `(event: RealtimeStreamEvent)=>void` — contained to `transport.ts` + `multiplexer.ts` + `pusher.ts` + `stream.ts`.
- `tq-3` (dep tq-1,tq-2): client differ `deriveFindDeltas(source, keyOf=d=>d.id)` + `streamEvents<TData>` on `RealtimeAPI` in `stream.ts`; keep `subscribe/stream/.live()/.liveIter` yielding full `TData` (materialize internally).
- `tq-4` (dep tq-2): `multiplexer.handleEvent` — honor `reset` on snapshot + add insert/update/delete/up-to-date branches forwarding the typed event; `pusher.ts` wraps snapshot/late-join replay as `{type:'snapshot'}`.
- `tq-5` (dep tq-3,tq-4): reducer rewrite in `packages/tanstack-query/src/index.ts` — `streamRealtimeQuery` iterates `streamEvents`; replace the 3 `reducer:(_,chunk)=>chunk` with shape-specific reducers (find keyed apply, count scalar, get single/null); in all 3 `{realtime:true}` branches destructure `{realtime,...overrides}` and add `staleTime:0`, `refetchOnMount:'always'`, `...overrides` (fixes the mount-fetch footgun + the ignored-overrides/placeholderData bug).
- `tq-6` (dep tq-5): tests in `realtime-query-options.test.ts`.

**delta-server** (emitter on HOLD; ds-2 buildable now)
- `ds-2` (no deps): ordered non-coalescing delta transport (`SseOrderedDeltaWriter`, append-only, byte-bounded, overflow→teardown) in `sse-client-transport.ts`; add `'row-delta'` `DeliveryClass` in `transport.ts`. (See §9 — prefer extracting the shared ordered-FIFO primitive already in `channel-event-ledger.ts` rather than duplicating.)
- `ds-3` (dep ds-1): admission caps + `mode` in `admission.ts` (see §8 cap-coherence).
- `ds-4` (dep ds-1): `columns?` on `SnapshotQuery` + `hydrateRealtimeRow(topic, context)` in `snapshot.ts` (single-row analog of `computeRealtimeSnapshot`).
- `ds-5` (dep ds-1,ds-2,ds-4): scheduler delta path in `refresh-scheduler.ts` — rewire the L167 listener `requestRefresh(seq)` → `onChange(group,event)`; `processDeltas` (FIFO, hydrate → `deriveDeltaOp` → per-row hash-suppress → encode). **Blocked on the §8 commit-order + late-joiner + locale + queue fixes.**
- `ds-6` (dep ds-3,ds-5): route wiring in `adapters/routes/realtime.ts` — read `mode`, build the hydrateRow closure (re-eval access per batch), route `onFrame(frame,kind)` snapshot→latest-wins / delta→ordered writer, force snapshot for shared-provider.
- `ds-7` (dep ds-5): observability (`observer.ts`) — `delta.emitted/suppressed/fallback_snapshot` + memory gauges.
- `ds-8` (dep ds-5): bulk fan-out (batch-hydrate; see §8 — MUST merge `topicWhere`).
- `ds-9` (dep ds-6,ds-8): acceptance suite (see §11).

**txid** (tx-1..7 now; tx-8/9 after ds-5)
- `tx-1` (no deps): xid8 drizzle customType (`fromDriver→String`) + nullable `txid` column `DEFAULT pg_current_xact_id()` on `questpieRealtimeLogTable` in `realtime/collection.ts`.
- `tx-2` (dep tx-1): thread `txid` through `RealtimeChangeEvent` (types.ts), `service.appendChange` `.returning()`, `readSince` select.
- `tx-3` (dep tx-2): in-tx txid channel — `AsyncLocalStorage` `recordTransactionTxid/getTransactionTxid` in `crud/shared/transaction.ts`; call it from the global `realtimeHook`/`globalRealtimeHook` in `app.ts` (already on the mutation-bound db).
- `tx-4` (dep tx-3): `shared/txid.ts` (`QUESTPIE_TXID_HEADER`, non-enumerable `QUESTPIE_TXID` symbol, `attachTxid/getTxid`); `crud-generator.ts` tx callbacks `attachTxid` the returned record/array (survives post-tx afterRead — symbol is non-enumerable).
- `tx-5` (dep tx-4): emit `X-Questpie-Txid` — `extraHeaders` on `smartResponse`; set from `getTxid(result)` in `routes/collections.ts` + `globals.ts`.
- `tx-6` (dep tx-5): client mutation results — `requestWithMeta`, read header in create/update/delete/restore/updateMany/deleteMany/updateBatch → `attachTxid(body,txid)`; re-export `getTxid/QUESTPIE_TXID`.
- `tx-7` (dep tx-1): regenerate migrations across consuming apps (barbershop, city-portal, autopilot). **Run twice, expect no diff.**
- `tx-8` (dep tx-2,tq-1,ds-5): frame watermark — `pg_snapshot_xmin` captured strictly before compute (snapshot.ts), stamp `upToDate` on snapshot + up-to-date + delta frames.
- `tx-9` (dep tx-6,tx-8,tq-5): client watermark resolution — pending-txid set from `getTxid`; resolve on `BigInt(upToDate)>BigInt(T)` or exact `txid===T`; watermark-math tests.

**tanstack-db** (independent; re-pin versions first)
- `db-1` (no deps): scaffold `@questpie/tanstack-db` (package.json / tsdown.config.ts / tsconfig / README / CHANGELOG mirroring `packages/tanstack-query`); **RE-PIN actual versions** (§8) + reconcile the existing `@tanstack/db ^0.1.1` devDep; peer + tsdown-external `questpie`, `@tanstack/react-query`, `@tanstack/react-db`, `@tanstack/query-db-collection`, `@tanstack/db`.
- `db-2` (dep db-1): type derivation `src/types.ts` — `CollectionKeys/CollectionSelectOf/CollectionRelationsOf/CollectionRowOf(ApplyQuery base-select)/IdOf/FindOptionsOf/QuestpieDb`, importing ONLY from `questpie/client`; mirrors `tanstack-query/src/index.ts` but the store element is a single **ROW**, not a `PaginatedResult`.
- `db-3` (dep db-2): runtime proxy `createQuestpieCollections(client, {...})` returning a name-caching Proxy (one `Collection<CollectionRowOf,IdOf>` singleton per name); re-export `useLiveQuery` + operators (`eq/and/or/gt/lt/inArray`).
- `db-4` (dep db-3): per-collection wiring `src/collection.ts` — `createCollection(queryCollectionOptions({ queryClient, queryKey, queryFn: (await client.collections[name].find(opts)).docs, getKey: r=>r.id, onInsert/onUpdate/onDelete → client mutations }))`. Isolate ALL TanStack DB beta surface here.
- `db-5` (dep db-4): sync seam `src/sync.ts resolveSync(client,name,options,mode)` — v1 `'refetch'` + `'snapshot'` (subscribe `client.collections[name].live()` → store replace); upgrading to delta swaps ONLY this function.
- `db-6` (dep db-5): tests (type-level + optimism/rollback + snapshot-sync + SSR no-cross-request-leak).
- `db-7` (dep db-5,tq-3,tx-6,ds-5) **future**: `'delta'` sync — apply keyed events from `streamEvents` + `collection.utils.awaitTxId(txid)`; `onInsert/…` return `{ txid: getTxid(result) }`.

---

## 8. MUST-FIX — verified blocking (resolve in design/impl)

1. **[ds-5] Commit-order drain gap (THE crux).** Outbox `seq` is a statement-time bigserial
   (`collection.ts:23`); `readSince` drains `gt(lastSeq)` advancing to the last row seen
   (`service.ts:830/953`). A lower seq committing AFTER a higher one is **permanently skipped** —
   harmless in self-healing snapshot mode, **set-corrupting in delta mode**. **Fix:** drive delta
   from a **commit-ordered cursor** before emitting native deltas — reuse the channel-event-ledger
   head-lock counter (`channel-event-ledger.ts:192-199`, seq assigned under a row lock so
   seq-order == commit-order) OR a lag-window rescan+dedupe in `readSince`. The txid track does NOT
   fix this (it only handles the client's own mutation, not third-party delta content loss).
2. **[ds-5/ds-6] Late-joiner bootstrap for shared delta groups.** Compute-once/deliver-many groups
   subscribers by `(topic, accessKey)` with a group-level `bootstrapped` flag; a joiner replays the
   stale `group.lastFrame` (refresh-scheduler L180-181) then only gets future deltas → misses deltas
   emitted before it joined. **Fix:** per-subscriber bootstrap — on each join compute a one-off
   snapshot at the group's latest delivered seq to that subscriber's `onFrame`; disable `lastFrame`
   replay for delta groups (client seq-guard drops overlap).
3. **[ds-4/ds-5] Locale hydration.** `processDeltas` must hydrate at the **topic/group locale**
   (identical to `computeRealtimeSnapshot`), **never `event.locale`** — else a 'de' edit leaks German
   values into an 'en' subscriber's set. `event.locale` may gate whether an event is considered, not
   the projection locale.
4. **[ds-8] Bulk hydrate omits `topicWhere`.** Batch hydrate MUST merge `topicWhere AND accessWhere
   AND {id:{in:recordIds}}` (identical to ds-4 mergeWhere): present⇒upsert, absent-from-result⇒delete
   (rows that left the set). Treat empty OR missing `recordIds` as the reset-snapshot fallback, not a
   no-op.
5. **[tq-4] No seq-based drop guard.** Bulk emits many frames at one seq; a `seq<=last` guard drops
   all but the first. **Do not dedupe by seq** — seq is resume cursor + FIFO only; rely on per-key
   idempotency + authoritative reset on resume. Correct the risk-register wording.
6. **[ds-1/ds-3] Classifier placement.** `admitRealtimeTopic` lacks collection/relation metadata, so
   `whereReferencesRelations` can't reliably tell a relation key from an own-scalar column. **Compute
   the mode in the route's `subscribeTopic`** (definition + access already resolved) and stamp `mode`
   onto both the admitted topic and the scheduler group. Drive relation detection from real relation
   metadata, not value-shape heuristics; reuse `analyzeWhere`'s where-tree traversal.
7. **[ds-3] Cap coherence.** `maxDeltaFindLimit=1000` vs `maxBufferedSnapshotBytes=1MiB` = teardown
   loop (~1KiB/row always trips). **Fix:** make caps coherent by construction (lower row cap to fit
   1MiB at a realistic serialized row size, or raise byte caps in lockstep) + an admission-time
   coherence check; an over-cap/truncated bootstrap → **non-retryable rejection or snapshot fallback**,
   never a silent retryable teardown.
8. **[ds-5/ds-3] Bounded deltaQueue.** The per-group queue is unbounded (producer = external write
   volume, consumer = serialized hydrate) → DoS. **Fix:** bound by count/bytes; on overflow drop the
   queue and collapse to a single reset snapshot (`delta.fallback_snapshot`).
9. **[ds-6/ds-9] Access eviction via existing mechanisms (no new machinery).** The cited "coarse
   session revalidation" does not exist. **Fix:** delta path reuses `PRECHECKED_READ_ACCESS` (per-row)
   + `watchedResources` (membership change → targeted re-bootstrap) + the periodic re-bootstrap
   (§3). Make ds-9's access-change test match this; document the widened staleness window vs snapshot.
10. **[tq-1/ds-1/tx-8] Freeze the wire from §5, complete the watermark frame.** Use `row` (not
    `value`); put `upToDate` on the `up-to-date` frame + an idle heartbeat so non-member mutations
    still resolve pending optimistic txids.
11. **[tx-8] Watermark capture strictly BEFORE compute** (fully awaited, or one read-only statement
    with the find). Forbid concurrent/post-compute/cached capture. Client resolves only
    `BigInt(upToDate)>BigInt(T)`.
12. **[tq-5/ds-5] totalDocs/pagination regression.** A delta result is single-page (limit/offset
    forbidden): have the find reducer / `.live()` recompute `{totalDocs:docs.length,totalPages:1,
    page:1,has*Page:false,prev/nextPage:null}` on each apply, OR emit the envelope in `up-to-date.meta`.
13. **[db-1] tanstack-db versions are wrong.** NOT `0.5.x`. Actual lines: `@tanstack/react-db 0.1.x`,
    `@tanstack/db 0.6.x`, `@tanstack/query-db-collection 1.x`. `@tanstack/db ^0.1.1` is ALREADY a
    devDep in `packages/admin` + `examples/tanstack-barbershop`. **Before scaffolding:** pin the
    actual current versions, prove the three are co-installable as peers, reconcile the monorepo
    `@tanstack/db` range to ONE hoisted identity, and **re-derive the `queryCollectionOptions` +
    mutation-handler contract from the installed 1.x code** (db-4/db-5 shapes are unverified until
    then). Land a compile-only smoke test gating db-2..db-6.
14. **[tx-1] PG<13 hard-fails (not graceful).** `xid8`/`pg_current_xact_id()` don't exist pre-13 → the
    migration hard-fails at `migrate:up`. **Fix:** state PG13+ as a hard requirement + a fail-fast
    startup/migration preflight (`SELECT current_setting('server_version_num')`) with a clear message.

---

## 9. CODEX DONAVRHNE — open design you own (within §2/§8 constraints)

1. **Commit-safe delta cursor** (must-fix 1) — pick and design the mechanism (head-lock counter vs
   lag-window rescan+dedupe); add the out-of-seq-order two-transaction no-drop test.
2. **Per-subscriber late-joiner bootstrap** (must-fix 2) — the exact deviation from
   compute-once/deliver-many, atomically attaching the join snapshot at the current seq.
3. **Cap coherence + bounded queue** (must-fix 7,8) — concrete numbers at a measured serialized row
   size; the coherence check.
4. **Single-row hydrate batching** (non-blocking, recommended) — coalesce per-drain single-row deltas
   into one `find({id:{in:distinctIds}})` (reuse the ds-8 batch path) so hot churn (C changes >
   set size n) doesn't regress to O(C) serialized `findOne`s; give delta hydrate a separate
   concurrency budget so it can't starve snapshot computes on `runBounded`.
5. **Shared ordered-FIFO writer** — extract the bounded-ordered-FIFO primitive already in
   `channel-event-ledger.ts` (`enqueueLocal/flushLocalPending/scheduleLocalRetry`) into ONE shared
   primitive used by both channels and the delta path, resolving the plan's open question (keep
   `'row-delta'` as an observability label only). If you deliberately duplicate, cross-reference so
   they can't drift.
6. **tanstack-db 1.x API** — re-derive `queryCollectionOptions` + `transaction.mutations[]` shapes
   from the installed code; confine ALL beta surface to `src/collection.ts` + `src/sync.ts`.
7. **PK source of truth** — tq-5 keys via `String(d.id)`; ds-5/ds-6 thread a configurable `rowKey`.
   Either assert questpie collections are always id-keyed and drop `rowKey`, or thread the PK field
   name through topic/frame; add a non-id-PK acceptance case if non-id PKs are supported.
8. **SSR pattern for tanstack-db** — make **per-request** QueryClient + per-request
   `createQuestpieCollections` the PRIMARY documented pattern for TanStack Start (the repo's target);
   the module-scope singleton is client-only (a shared store leaks one request's optimistic overlay
   into another). Add an SSR no-cross-request-leakage test.
9. **migrate:generate idempotency for the volatile default** — the `tsvector` precedent uses
   `.generatedAlwaysAs()`, not a volatile default; verify no perpetual diff, else pin
   `.default(sql\`pg_current_xact_id()::text\`)`.

---

## 10. Per-track design notes (mechanisms verified against code)

**Wire / tanstack-query.** Today `refresh-scheduler.ts:265` emits one `snapshot` frame (full
`computeRealtimeSnapshot`); `multiplexer.ts:546-607` understands only `snapshot|session|ping|error`
and **drops `reset`** (latent bug to fix in tq-4). `RealtimeSubscriber=(data)=>void`
(`transport.ts:3`). Ship the client differ FIRST (self-contained in transport/multiplexer/pusher/
stream), keep `subscribe/stream/.live()/.liveIter` yielding full `TData` (materialize events
internally), add `streamEvents` for the keyed-apply path. Pusher is inherently full-snapshot
(re-fetches via REST on a wake) → wrap as a `{type:'snapshot'}` bootstrap.

**txid.** The realtime append is no longer in the CRUD generator; it fires from **global hooks in
`server/modules/core/config/app.ts`** — `realtimeHook.afterChange/afterDelete` (L160/L186) and
`globalRealtimeHook.afterChange` (L363), each INSIDE the mutation tx with `{ db: asRealtimeMutationDb
(ctx.db) }` (`ctx.db === tx`). `RealtimeService.appendChange` (`service.ts:351`) does
`db.insert(...).values(...).returning()`. A column `DEFAULT pg_current_xact_id()` therefore evaluates
inside the mutation tx and equals the mutation's own xid8, surfaced via `.returning()` with zero extra
round-trips. afterRead/output hooks run AFTER the tx closes (`crud-generator.ts:1690-1702`), so this
never depends on an in-tx read-back (avoids the Bun-SQL deadlock caveat). Store as `xid8` via a
drizzle customType with `fromDriver→String` (removes 64-bit driver-parse ambiguity); compare via
`BigInt()` client-side.

**tanstack-db.** `createQuestpieCollections(client, { queryClient, syncMode, ... })` → a name-caching
Proxy returning `Collection<CollectionRowOf<TApp,K>, IdOf>` singletons, typed by mirroring
`tanstack-query/src/index.ts` type derivation — but the store element is a single **base-select ROW**
(via `CollectionRowOf`/`ApplyQuery`), not a `PaginatedResult`. `queryFn = (await client.collections
[name].find(opts)).docs`; `getKey = r=>r.id` (ids are strings). Reads/joins via `useLiveQuery((q)=>
q.from({post: db.collections.posts}).join({author: db.collections.users}, ...))`.

**delta-server.** `classifyRealtimeDelivery` → `'delta'` only for `collection.find` with no
`orderBy`/`limit`/`offset`/`with` and non-relation own-column `where`; else `'snapshot'`.
`hydrateRealtimeRow(topic, ctx)` = `crud.findOne({ [PRECHECKED_READ_ACCESS]: accessWhere,
where: mergeWhere(topicWhere, {id: recordId}), columns, with, locale })` — the byte-identical
single-row analog of `computeRealtimeSnapshot`. `deriveDeltaOp({present, operation, beforeMatch})` →
insert/update/delete/noop (scalar `before` projection only labels insert-vs-update; membership is
authoritative from the hydrate). Per-row hash-suppression (delta analog of the snapshot SHA-256
dedupe), `lastRows` LRU bounded at the row cap.

---

## 11. Verify / acceptance (extend, don't skip)

- **ds-9 delta acceptance:** out-of-seq-order two-transaction **no-drop**; late-joiner receives a
  full bootstrap then only newer deltas; **two-locale isolation**; **two-principal access isolation**
  (row/field/afterRead) on the delta path; bulk-budget → reset fallback; soft-delete → delete;
  access-change (membership) → delete via the chosen mechanism; per-row hash-suppression.
- **tq-6:** streamEvents mock; bootstrap+insert+update+delete keyed apply with **unchanged-row
  identity**; up-to-date `meta.totalDocs`; count/get replace; non-retryable admission error after one
  attempt; options carry `staleTime:0`/`refetchOnMount:'always'` + honored overrides.
- **tx tests:** response `txid == outbox row txid`; **no early optimistic resolution** while a
  concurrent lower-xid tx stays open; PG13 preflight message.
- **db-6:** type-level (`db.collections.<n>` element == client `find()` row; unknown collection = a
  compile error; join/where field access typed) + optimism/rollback + snapshot-sync + **SSR
  no-cross-request-leakage**.
- **Migrations:** `migrate:generate` twice → no diff.

---

## 12. Key files

- Server realtime: `packages/questpie/src/server/modules/core/integrated/realtime/{refresh-scheduler,snapshot,service,collection,types,admission,sse-client-transport,transport,channel-event-ledger,observer}.ts` + new `delta.ts`; route `packages/questpie/src/server/adapters/routes/realtime.ts`.
- txid: `.../realtime/collection.ts`, `.../crud/shared/{transaction.ts,realtime.ts}`, new `.../shared/txid.ts`, `.../crud/crud-generator.ts`, `server/modules/core/config/app.ts`, `adapters/{routes/collections.ts,routes/globals.ts,utils/response.ts}`, client `packages/questpie/src/client/index.ts`.
- Client realtime: `packages/questpie/src/client/realtime/{stream,multiplexer,pusher}.ts` + `client/realtime/transport.ts`.
- tanstack-query: `packages/tanstack-query/src/index.ts` (+ `realtime-query-options.test.ts`).
- tanstack-db (new): `packages/tanstack-db/` (mirror `packages/tanstack-query/`).

Design doctrine reference: `.../realtime/TRANSPORT.md` (outbox=correctness, broker=latency).
