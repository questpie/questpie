# questpie

## 3.24.0

### Minor Changes

- [#228](https://github.com/questpie/questpie/pull/228) [`e23ad85`](https://github.com/questpie/questpie/commit/e23ad853d9c62b3e575d8cb9420ed63fe8924270) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Stop realtime discarding writes and swallowing the reason a subscription failed.

  **A failed change capture no longer hands you a record for a row that does not
  exist.** Capture runs inside the caller's transaction, so a failure there has
  already aborted it. The `catch` that swallowed the error could not save the
  write: the later `COMMIT` was silently degraded to `ROLLBACK`, and `create()`
  resolved with a fabricated record carrying a generated id while the row was
  absent. Reproduced for `42P01` and `55P03`. A capture failure is now always
  fatal to the write.

  That rollback used to be gated on `realtime.nativeDeltasEnabled`, which made a
  delivery-mode flag load-bearing for write correctness — and its default of
  `false` was the losing setting. The flag now selects a delivery mode and nothing
  else. A missing realtime log table is also no longer silenced; it reports itself
  as the configuration error it is.

  **A stream that fails to start reports it.** The catch closed the stream
  controller before calling `controller.error()`, and a closed controller discards
  it, so any failure inside the SSE `start()` reached the client as HTTP 200 and a
  cleanly closed empty stream. The error is now raised before teardown. Note the
  remaining gap: once any topic has received a sequence, the client still
  suppresses connection errors and retries silently, so this fixes the server half
  only.

  **Topology rejections arrive typed, at the right topic.** Two separate faults
  made every rejection on the control channel useless. It is keyed by
  `topologyEntryId` while the client read only `topicId`, so it resolved to
  `undefined` and reached nobody; and the control handler forwarded only
  id/kind/code/message, discarding the typed rejection the server attaches under
  `rejection`, so even a routed one could only ever become a bare `Error` and the
  rejected topic stayed mounted in the desired topology. Both are fixed, so these
  now raise `RealtimeTopicRejectedError` with a reason and tear the topic down.
  This matters more than it sounds: the open POST carries only the topics present
  at connect, so every topic mounted afterwards travels this path.

  One gap remains, and it is in a path the framework itself never takes.
  `RealtimeMultiplexer` can be constructed directly without a shared connection,
  and its own stream loop suppresses connection errors once any topic has received
  a sequence. `createRealtimeSession` always injects `SseConnectionManager`, which
  classifies terminal statuses, so first-party clients are unaffected.

  **`RealtimeTopicRejectionReason` covers the reasons the server actually emits.**
  It had five members while the server produced twelve, so `connection_limit` —
  the reason behind a filled connection cap — could not be expressed, let alone
  classified. Added: `connection_limit`, `subscription_limit`, `access`,
  `not_found`, `operation_shape`, `since_seq_invalid`, `activation_rejected`, plus
  an `observed` count beside `configuredLimit`, because those two numbers are the
  whole diagnosis. The server and client now share one union instead of two that
  drifted. `isRealtimeTopicRejectedPayload` is exported, so consumers stop
  reimplementing the guard.

  This is the source-breaking part: an exhaustive `switch` over
  `RealtimeTopicRejectionReason` will now fail to compile. That is the intended
  outcome.

  **Context extensions are part of the subscription group key.** They decide what
  field-level access, `columns` and `afterRead` return, so subscribers whose
  extensions differ are not entitled to the same bytes. Leaving them out meant a
  single user with two workspaces open could receive the first workspace's rows in
  the second workspace's tab, with no configuration involved. An extension that
  cannot be serialized now isolates the subscriber instead of sharing.

  `scaling.mdx` claimed every row was re-checked against each subscriber's own
  rules on every recompute. It is not, and a second page said so. The page now
  describes what actually holds: row-level rules are safe because the access
  predicate is part of the group key, while field-level access, `columns` and
  `afterRead` run once per group.

  **A shared group survives losing the subscriber that created it.** A group computes
  once and delivers to everyone, so one subscriber's closure does the work — and
  that closure asserts its own connection's fence. When the creating connection
  went away the group kept calling it, so every remaining subscriber received
  `Realtime owner is fenced` and no further snapshot, permanently, with nothing
  classifying the error as terminal so nothing tore the topic down. Two tabs and
  closing the first was enough. The group now adopts a live subscriber's closures.

  This does not make a widened group key safe on its own: the adopted closure
  still carries its own context, so field-level access, `columns` and `afterRead`
  run as whichever subscriber is currently providing.

  **A node with no subscribers stops replaying the outbox at boot.** `initialize()`
  runs on every node while the drain cursor is seeded only by `subscribe()`, so an
  idle node walked the entire retained window — three days of it by default — into
  an empty listener set, on every deploy.

  Also removed: a per-capture `max(seq)` subquery over the whole log, and a second
  head-row `UPDATE` writing a column that is never read.

### Patch Changes

- [#228](https://github.com/questpie/questpie/pull/228) [`e23ad85`](https://github.com/questpie/questpie/commit/e23ad853d9c62b3e575d8cb9420ed63fe8924270) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fix channel subscriptions over SSE denying every rule that reads the app service
  surface, and stop a rule that threw from reporting itself as a denial.

  `ChannelOperationContext` is an `AppContext`, so an `authorize` or `presence`
  rule may read `collections`, `globals`, `services`. Route handlers get that
  surface folded in by `executeRoute` and collection access rules get it from
  `executeAccessRule`, but the SSE endpoint (`POST /realtime`) handed the rule the
  lean `RequestContext` that `app.createContext()` returns. `context.collections`
  was `undefined`, the rule threw, and `POST /realtime` answered
  `REALTIME_SUBSCRIPTION_REJECTED / "Channel subscription is denied"` — for an
  actor who satisfied the rule. Collection realtime was unaffected, which is why
  this looked like a channel-only access problem.

  All three request-path construction sites now build the rule context through one
  factory, `createChannelServiceContext`, which folds the service surface in.

  The second half is why it took two investigations to find the first.
  `evaluateRule` caught everything and returned `false`, so a `TypeError`, a typo,
  a missing context field and a genuine denial were one indistinguishable outcome.
  A rule that throws still fails closed, but it now logs at error level with the
  cause and raises `channel_rule_failed`: the SSE frame says which channel's rule
  failed instead of claiming a verdict, and the channel HTTP routes answer 500
  rather than 403. A rule that times out still denies — no answer means no. The
  rule's own message stays server-side.

## 3.23.0

### Minor Changes

- [`bec0c23`](https://github.com/questpie/questpie/commit/bec0c23a78f1318a86c09e8d02f1584c89605c50) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Remove the deprecated `discoverPatterns` option from `ModuleTemplateOptions` in
  `questpie/codegen`.

  Registry augmentation moved to the root template some time ago and
  `generateModuleTemplate` stopped reading the option then, so passing it has been
  a no-op. It is gone from the type and from both call sites.

  If you pass it to `generateModuleTemplate` in your own codegen plugin, delete the
  line. Nothing else changes: the generated output is byte for byte the same,
  because the option never reached it.

  Note that `generateTemplate` has its own `discoverPatterns`, which is live and
  untouched. Only the module-template one is removed.

### Patch Changes

- [`76bf85c`](https://github.com/questpie/questpie/commit/76bf85c681bf3187338574d8a9b4e21e47ac9051) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fix the realtime client posting an empty topic list when the last subscriber
  leaves while the connection is being opened.

  `connect()` checks that there are topics, then suspends on `getAuthHeaders()`.
  Anything that emptied the topic map in that window — a route change, an effect
  cleanup, a double-invoked mount — produced `{ topics: [] }` on the wire. The
  server rejects that with `realtime.topicsRequired`, and the client swallowed the
  400 because its error path saw an empty map and returned without retrying. It
  showed up as silent failed requests on every page load, one per live arm.

  The guard is now re-read after the suspension, and the payload is built before
  it. If topics emptied and refilled during the await, the connect still goes out
  well-formed and the control channel reconciles the topology right after.

## 3.22.0

### Minor Changes

- [`17b6cab`](https://github.com/questpie/questpie/commit/17b6cabffb8f340270c4caf4f8da36be42310fb7) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Close a set of holes where the framework promised something and quietly did not
  do it.

  **Codegen no longer fails silently.** A `modules.ts` that could not be imported
  was caught, reported only under `--verbose`, and then codegen removed the output
  directory and wrote a core-only artifact over the correct one, with exit code 0.
  One unbuilt dependency erased every category, collection extension and factory
  method with no message. It now throws. The same bug pair in `module-metadata.ts`
  is fixed too, along with a Windows drive-letter path that parsed as a URL scheme
  and `modules.mts`, which discovery already accepted.

  **A module's `emails/` directory reaches the app.** The module template emitted
  the key `emails` while `create-app` read `emailTemplates`.

  **Deep imports into module internals are closed.** `"./*": "./*"` shipped
  `dist/server/modules/*/.generated/module.mjs` to consumers of `questpie` and
  `@questpie/admin`. It is replaced by explicit `./internal/*` subpaths carrying
  types only.

  **`module()` keeps dependency types.** It lacked `const`, so a module's own
  `modules` array was widened away.

  **Targets have one owner.** `root`, `outDir`, `outputFile` and `generate` come
  from the owner instead of merging, a duplicate output path throws instead of one
  target deleting another's work, and `target.generate` now runs in package mode.

  Field and context fixes:

  - `f.upload().multiple()` owns a `jsonb` column. It set `virtual: true,
columnFactory: null`, which is the shape of `hasMany`, so the array had
    nowhere to go and `.localized()` was a silent no-op.
  - `f.upload({ mimeTypes, maxSize })` reaches the admin control. Both were
    destructured and discarded.
  - The email service boots without an adapter. It threw at startup, so an app
    that never sends mail could not start, and `MailerService`'s own development
    fallback was unreachable.
  - `global().options({ scoped })` sees context keys you added. It was typed
    against an interface with no augmentation seam, so its own documented example
    did not compile.
  - `ctx.tables` resolves instead of being `undefined`, and `ctx.executor` and
    `ctx.observability` are typed as well as set.

  Removed, with no deprecation because there are no users on it:

  - `createClient({ crdt })`. Configure the engine on `createCrdtClient(client,
{ runtime })`. The old slot put the client CRDT implementation into every
    bundle, which is what splitting it out was meant to prevent. This also fixes
    `createElysiaClient`, which read the removed `client.crdt` getter and threw
    before it could return a client.
  - `generateModule()`. Use `packageConfig()` and `questpie generate`.

### Patch Changes

- [`b5b4a81`](https://github.com/questpie/questpie/commit/b5b4a81f2864d0e17f960b3e1e52c727d45b7124) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add the zero-config PGlite `createTestApp()` lifecycle with committed migrations, extension modules, bounded setup, and ordered idempotent disposal. Accept the real PGlite client type directly in QUESTPIE runtime configuration.

- [`195648d`](https://github.com/questpie/questpie/commit/195648dba74395dfa1d37c6ba9382c40ef63c8e3) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Generate a typed `#questpie/app-factory` entrypoint for creating fresh, independently destroyable app instances with explicit runtime adapters while preserving the existing `#questpie` singleton API.

- [`cd62bb8`](https://github.com/questpie/questpie/commit/cd62bb8bf4df98b3f75c4a894ba8148677a3b9ae) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Apply collection read access predicates directly to version snapshots before pagination, including localized history, and fail closed for predicates that cannot be evaluated safely against version tables.

## 3.21.1

### Patch Changes

- [#220](https://github.com/questpie/questpie/pull/220) [`5c5f5b6`](https://github.com/questpie/questpie/commit/5c5f5b672acfeca55cf7ffd6db97dec535997bfe) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Reconnect retryable SSE transport failures without terminating channel consumers, while preserving fail-closed authorization, protocol, and replay-gap errors.

## 3.21.0

### Minor Changes

- [#214](https://github.com/questpie/questpie/pull/214) [`fb6653a`](https://github.com/questpie/questpie/commit/fb6653a8b41d5c7e61bf4fa209b2ec86cf91ec7b) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add a typed Better Auth integration bridge that atomically commits Auth state and an encrypted, idempotent QUESTPIE Queue dispatch.

## 3.20.1

### Patch Changes

- [#215](https://github.com/questpie/questpie/pull/215) [`4e4ea31`](https://github.com/questpie/questpie/commit/4e4ea3174bce830b1a8efa95faf381aa36b88b24) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fence Channel replay, live delivery, presence, and stale subscription callbacks when a shared Pusher connection leaves its connected epoch, then re-admit mounted subscribers only after the fresh subscription replay completes.

## 3.20.0

### Minor Changes

- [#212](https://github.com/questpie/questpie/pull/212) [`030c5dd`](https://github.com/questpie/questpie/commit/030c5dd09be7798fcb696e4e47312c758e855930) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add `onReady` to channel subscriptions — a provider-neutral signal that the
  subscription is authorized **and** has finished replay catch-up.

  ```ts
  client.channels.subscribe("space", { spaceId }, handler, {
    onReady: () => {
      // authorized, caught up; everything from here is live and complete
    },
  });
  ```

  Until now a subscriber had no way to tell "still replaying history" from
  "caught up and live". The only callback was `onError`, so applications either
  guessed with a timer or treated the first frame as readiness — which is wrong
  whenever replay has more than one frame to deliver.

  The signal fires once per transport subscription epoch and works the same way on
  SSE and Pusher. On SSE the server emits a `channel_ready` control frame after
  authorization and catch-up; the client orders it against replay and live
  delivery so a subscriber never sees a live frame before its readiness callback.
  Reconnects end the epoch and re-signal.

  Presence subscriptions deliberately do not expose it —
  `ChannelPresenceOptions` is `ChannelSubscribeOptions` without `onReady` — because
  a presence read is one-shot and has no catch-up to complete.

  Consumer callbacks are also isolated from one another: a throwing `onReady` or
  `onError` in one subscriber no longer takes down delivery for its siblings.

  The channel transports are also loaded on demand now, so an application that
  never opens a channel no longer pays for them at all. Together with the change
  above the browser entry chunk drops from 180.5 KB to 115.6 KB — roughly 65 KB
  less than before this feature was added.

## 3.19.2

### Patch Changes

- [#208](https://github.com/questpie/questpie/pull/208) [`8114e59`](https://github.com/questpie/questpie/commit/8114e5966ffce9ecc2dd1c3be844dfff065b8af3) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Keep app context resolver services isolated in a system context, including when resolution starts inside an ambient user request such as fresh realtime authorization.

## 3.19.1

### Patch Changes

- [#205](https://github.com/questpie/questpie/pull/205) [`15a9f47`](https://github.com/questpie/questpie/commit/15a9f4726fdd68402532f3d6683b657e02a65863) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fix Redis Streams dropping wakes published right after `start()`.

  `RedisStreamsChangeBroker.start()` connected its reader and then launched the
  read loop **without awaiting it**, and the loop opened with `XREAD … id="$"`.
  `$` means "messages that arrive after this call reaches the server", so anything
  published between `start()` resolving and the loop's first read was silently
  dropped and never redelivered:

  ```ts
  await broker.start({ onWake });
  await broker.publish(wake); // could vanish
  ```

  `pg-notify` never had this problem — its `start()` awaits `LISTEN`, so the
  subscription exists before it returns. Two implementations of one `ChangeBroker`
  interface were giving different delivery guarantees.

  `start()` now resolves the concrete stream id first and reads from there, so it
  means "subscribed from here" rather than "reader connected". Clients that cannot
  report stream info fall back to `$`, which is no worse than before.

  This is what a flaky CI failure in the realtime driver matrix turned out to be —
  the test timed out on the full deadline rather than near it, which is the
  signature of a message that never arrives rather than a slow one.

## 3.19.0

### Minor Changes

- [#204](https://github.com/questpie/questpie/pull/204) [`7510720`](https://github.com/questpie/questpie/commit/7510720b88e1688998f5bfe5e098f7a7b3313b38) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Concurrency control, transactional integrity, channel authority, secret queue
  payloads, observability, and a productionalization pass over the framework.

  **Released as a minor despite the removals below.** There are no published
  consumers yet, so removals are folded in rather than held for a major. They are
  still listed in full — a changelog that hides a removal to keep a version number
  tidy is worse than the version number being surprising.

  ## Canonical revisions and optimistic concurrency

  Framework-owned canonical revisions reach collection and Global CRUD, clients,
  REST/OpenAPI, TanStack Query and Admin mutation flows. `revision` is distinct
  from version-history sequencing and from CRDT clocks; history snapshots record
  `sourceRevision`; stale and incomplete bulk preconditions fail atomically before
  any durable effect; owner-derived history access closes cross-tenant reads.

  Optimistic delete hooks run inside the revision-checked transaction and
  revalidate the locked row before committing. Collections without optimistic
  concurrency keep their established pre-claim delete-hook ordering, including
  TOCTOU-aware hooks, without self-deadlocking on the framework row lock.

  ## Transaction-bound hooks fail atomically

  Errors from `afterChange`, `afterDelete` and purge hooks now propagate and roll
  back the owning mutation together with nested CRUD, Queue, Channels and realtime
  ledger work. Previously they were caught, logged and swallowed, so a failed hook
  left a committed write behind.

  ## Channel authority revocation

  Durable, provider-neutral revocation of channel authority, with exact SSE
  fencing and signed-user Pusher reconnect reauthorization.

  ## Secret queue dispatches

  Short-lived secret payloads can be dispatched transactionally. Payloads are
  envelope-encrypted before durable storage or broker publication, wrapped data
  keys are erased after durable completion or an unclaimed broker-terminal
  outcome, and applications can read a payload-free queued/completed/failed
  receipt by stable dispatch id.

  pg-boss is qualified through durable broker-state reconciliation. Secret
  publication **fails closed** on BullMQ, Cloudflare Queues and unqualified custom
  adapters. Deploy the additive Queue ledger migration before enabling secret
  dispatches; existing rows remain ordinary non-secret dispatches.

  ## Observability

  Tracing and metrics through a framework seam plus the new
  `@questpie/observability` package: database query and transaction spans on every
  `db` variant, metrics and logs signals, and inbound trace-context continuation.

  ## Admin

  Per-field component slots — `.admin({ components: { field, cell } })` lets one
  field instance point at its own components without registering a whole new field
  type. The value is a registry key, not a component, because `.admin()` is
  serialized from the server through field introspection; an unrecognised key
  falls back to the by-type component rather than rendering nothing.

  ## Removed

  - `createAdapterRoutes` and the legacy route closure factories — routes are
    defined with `route()`; the framework no longer ships two ways to mount a
    handler.
  - `client.crdt` — use `createCrdtClient(client)` from `questpie/crdt`.
  - `AdminTypeRegistry` and the four `Registered*` types. The interface was never
    exported, so no application could reach it to augment; every derived type
    resolved to a constant and every consumer conditional was a dead branch. Two
    READMEs documented the augmentation and promised inference it could not
    deliver.
  - The last `@deprecated` API in `questpie` and `@questpie/admin`. Internal
    imports of the framework's own deprecated API are now **zero**, down from 166.

  ## Fixed

  - **Builders lost the app field map on every derivation.** `_fieldDefs` was
    assigned once in `create()` and carried by none of the nineteen derivation
    sites, so `collection("posts").admin({…}).fields(({ f }) => f.richText())`
    fell back to the builtins and threw, while the type still advertised
    `richText`. Both builders now derive through one helper that carries all
    private state.
  - **`.validation()` silently narrowed what a collection accepted.** It built its
    own schema without the id, timestamp and soft-delete columns the constructor
    adds; because both paths end in a stripping Zod object the loss threw nothing.
    Calling it removed the ability to pass a custom id on create and made
    restore's `deletedAt` write a no-op.
  - **Collection access rules now fail closed** on a rule shape the type system
    does not admit. Both evaluators previously ended in an unconditional allow —
    one of them on the enforcement path.
  - A global access rule returning a non-boolean now denies.
  - `f.upload().multiple()` returned a field with no state, losing its type,
    metadata and target collection.
  - `crdt`, `observability` and `executor` config leaked into `app.state`.
  - Observability never flushed on shutdown; the last batch of spans, metrics and
    logs was lost on every clean exit. It was also silently dropped from the
    runtime config entirely.
  - `questpie dev` stripped module-contributed codegen on every save, and
    `questpie generate` silently repaired it.
  - The `locale` and `localeFallback` options were declared and then ignored.
  - Globals had no field-schema overlay, so `f.email()` published as a bare string
    while the identical field on a collection published the format.
  - Custom dashboard widgets rendered "component not found"; the workflows sidebar
    and its widgets were missing.
  - `{{ param }}` with spaces now interpolates in server messages.
  - `generateModule` is now actually exported from `questpie/codegen`.
  - OpenAPI schema component names match the rest of the framework.

  ## Performance

  - Field builder chains typecheck **about twice as fast** — field methods moved
    onto the class instead of a 27-key mapped type.
  - The client no longer bundles `qs`: **−90 KB** from the browser bundle.

  ## Internal

  CI ratchets that keep the cleanup from rotting: `dead-modules`, `lint-census`,
  `deprecated-imports`, `clone-census`, alongside the existing any-census,
  type-budget and size budgets. Each fails on an increase, so every count above
  can only go down.

## 3.18.0

### Minor Changes

- [#191](https://github.com/questpie/questpie/pull/191) [`62992aa`](https://github.com/questpie/questpie/commit/62992aa22f0708cc0bf545231f1e6f9f47b58516) Thanks [@drepkovsky](https://github.com/drepkovsky)! - `ApiError.conflict`, `ApiError.notFound`, `ApiError.forbidden` and
  `ApiError.internal` now accept an optional `messageKey` and `messageParams`, so
  the errors they raise can be localized. Previously only `badRequest` and
  `unauthorized` could carry a caller-supplied key.

  Before this change a consumer localizing its UI had no way to localize these
  four. Two of them were worse than merely untranslated: `conflict` and `internal`
  **unconditionally** set the generic keys `error.conflict` and `error.internal`,
  so an app with a translator configured did not just fail to translate the
  specific message — it discarded it. `ApiError.conflict("Post 42 was modified by
someone else")` reached the client as "Resource conflict". Without a translator
  you got untranslated English; with one you got a generic string. Neither is a
  localized, specific message.

  Conflicts are the most visible class of these — optimistic-concurrency
  failures, uniqueness violations, invariant breaches. They are exactly the errors
  a user is most likely to see and least able to act on, and they were the ones
  with no path to the user's language at all.

  The framework had already been routing around the gap. The search routes in
  `server/adapters/routes/search.ts` hand-build
  `new ApiError({ code: "FORBIDDEN", ..., messageKey: "search.reindexAccessDenied" })`
  and `new ApiError({ code: "NOT_FOUND", ..., messageKey: "search.serviceNotConfigured" })`
  rather than call the constructors, because the constructors could not carry a
  key. Those call sites are left alone here, but they no longer have to be written
  that way.

  ```ts
  throw ApiError.conflict(
    `Post ${id} was modified by someone else`,
    "post.conflict.staleVersion",
    { id }
  );
  ```

  Both parameters are **appended** and optional — nothing was reordered and
  nothing became required. All 95 existing call sites in `packages/questpie/src`
  compile untouched, and so does any consumer code calling these four. When no key
  is passed, every constructor produces the same `ApiError` it did before: same
  `code`, same `message`, same default `messageKey`, same `messageParams`.

  Two details worth knowing:

  `forbidden` takes the key as a further parameter rather than as a field on its
  `AccessErrorContext`. That context is serialized verbatim into the client-facing
  `context.access` payload, so putting translation metadata there would change the
  wire shape and ship the key twice. Trailing parameters also match how
  `badRequest` and `unauthorized` already read.

  The parameters a constructor already derives stay available to your key and can
  be overridden: `notFound` always exposes `{{resource}}` and `{{id}}`, and
  `forbidden` always exposes `{{reason}}`. So `ApiError.notFound("Post", id,
"post.notFound")` can interpolate `{{id}}` without you passing it again.

  No rendering-side change was needed — `toJSON` and `getTranslatedMessage`
  already translate through whatever `messageKey` an error carries.

## 3.17.0

### Minor Changes

- [#188](https://github.com/questpie/questpie/pull/188) [`f534369`](https://github.com/questpie/questpie/commit/f53436930137368000294877b5f02ced55b2dbf4) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add collection-wide collaborative aggregates with typed text and set fields.

  - Declare collaborative owners and fields with `.collaborative()` and `.crdt()`, then consume their generated, fully typed client and server APIs.
  - Synchronize CRDT bytes through bounded Fetch routes while reusing the existing SSE or Pusher realtime session for opaque dirty hints, with no adapter-specific host or second provider connection.
  - Preserve aggregate-wide atomic transactions, fresh field-level authorization, lifecycle fencing, idempotent retry, offline IndexedDB recovery, and bounded awareness rosters.
  - Create and resolve bounded opaque text anchors through symmetric typed browser and request-scoped server field APIs, preserving ordinary edits while detaching across field or owner recreation.
  - Publish Yjs text engines for browser and server use from `@questpie/crdt-yjs`; its worker entry remains private package runtime machinery, and its bounded pool drains and terminates with application shutdown.

- [#183](https://github.com/questpie/questpie/pull/183) [`4be1529`](https://github.com/questpie/questpie/commit/4be15299ffafa8a4808474823815a3dc6d49689d) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Remove the deprecated realtime compatibility layer and make Realtime v2 the only supported contract.

  QUESTPIE currently has no external realtime adopters, so this cleanup ships during
  the pre-adoption 3.x window as a minor release instead of reserving an otherwise
  empty 4.0 major solely for the removed compatibility surface.

  - Remove `RealtimeAdapter`, `realtime.adapter`, `realtime.rollout`, the `legacy` and `dual` modes, and the old Postgres, Redis Streams, and Cloudflare realtime adapter entrypoints.
  - Remove delta control frames and client downgrade behavior. Companion control now requires complete desired topology protocol v2.
  - Keep `ChangeBroker`, the distributed topology coordinator, structured non-retryable admission errors, and the default `maxFindLimit` of 100 as the supported framework path.

  Upgrade all QUESTPIE realtime clients and servers together within the consolidated
  3.x minor train. Postgres apps continue to receive the automatic
  `PgNotifyChangeBroker`; Redis deployments should configure
  `redisStreamsChangeBroker`.

- [#188](https://github.com/questpie/questpie/pull/188) [`079be69`](https://github.com/questpie/questpie/commit/079be6971f1ff3b8f6aed4a1c8bc0b3182bfcb99) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add a generic, Admin-independent client i18n adapter with strict locale and
  catalog validation, bounded Intl formatter caches, base-language RTL detection,
  and separately importable React bindings built on `useSyncExternalStore`.

  Reuse the generic adapter and React bindings inside `@questpie/admin` while
  preserving its server-fetched catalog compatibility layer.

- [#188](https://github.com/questpie/questpie/pull/188) [`d752314`](https://github.com/questpie/questpie/commit/d75231406e016b0e07f36182fc6dc9dbb1f8b224) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add the Realtime v3 snapshot/delta event contract, opt-in native SSE row deltas,
  transaction-id reconciliation, TanStack Query delta reduction, and the new
  TanStack DB collection package.

  - Add collection- and application-level row-live-query policies, bounded
    server-only subscription scopes and access-equivalence keys, conservative
    three-valued topic routing, structured classifier diagnostics, high-fanout
    observability, and deterministic 100k-subscription benchmark scenarios.
    Unsupported or ambiguous predicates remain candidates; only a proven miss
    suppresses refresh.
  - Keep disabled row live queries isolated from collection dependency capture,
    application channels, CRDT notices, and broker coordination, and reject them
    before allocating subscription state.
  - Preserve `Date` identity and exact epoch milliseconds across official typed
    CRUD, realtime, Channels, replay, presence, TanStack hydration, and
    reconciliation paths through one versioned exact-path wire contract. Keep
    `f.date()` as an exact `YYYY-MM-DD` string, require explicit RFC 3339 zones
    for external datetime input, and emit accurate OpenAPI `date`/`date-time`
    schemas.
  - Publish every fixed-group companion against the current Questpie minor train
    instead of retaining a `^3.16.0` peer floor.
  - Database startup now enforces QUESTPIE's documented PostgreSQL 15 minimum; the
    realtime xid8 schema still has its explicit PostgreSQL 13 capability preflight.
  - Make the existing typed Queue `publish(payload, options)` operation
    ambient-transaction-aware without adding a public outbox API. pg-boss inserts
    through the current Drizzle transaction; BullMQ, Cloudflare Queues, and custom
    external adapters use the framework-owned `questpie_queue_dispatch` ledger
    with leased crash recovery. Deploy the generated migration before this
    version.
  - Add portable `idempotencyKey` and stable logical `dispatchId` metadata,
    retain adapter-portable idempotency receipts, reject ambiguous
    `idempotencyKey` + `singletonKey` combinations, explicitly settle pg-boss
    `runOnce()` jobs, and keep Cloudflare poison or exhausted-retry messages
    observable for platform failure/DLQ handling. Queue delivery remains
    at-least-once, and `publish()` now returns the logical dispatch UUID for all
    built-in adapters instead of an adapter-specific physical id or `null`.
  - Bound Queue relay recovery to 25 adapter-publication attempts, expose terminal
    counts and payload-free structured errors through `queue.drain()`, and allow
    bounded multi-batch recovery through `maxBatches`. pg-boss deployments using
    a separate database must set `useApplicationTransaction: false`.

- [#188](https://github.com/questpie/questpie/pull/188) [`c1ab1c0`](https://github.com/questpie/questpie/commit/c1ab1c0b8873a66a163effbc31ec431a5d442298) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add a separately authorized physical-purge lifecycle for soft-delete collections.

  - Expose capability-aware `purgeById` server, HTTP, browser client, OpenAPI, and TanStack Query surfaces without adding a force-delete alias.
  - Require an explicit `purge` access rule, reject active rows, hide denied or missing targets behind the same not-found result, and run dedicated fatal purge hooks transactionally.
  - Strictly prevalidate purge `AccessWhere` trees so unknown or unsupported leaves, including leaves nested below `NOT`, fail closed.
  - Block retained collection/global relations and concurrent foreign-key DDL instead of converting soft-delete cascades into destructive cascades. Declared relation writes to a missing registered target now fail with bad request so a writer delayed behind purge cannot commit a dangling reference.
  - Serialize purge per collection behind a PostgreSQL schema fence, bound relation-lock waits to three seconds, and return a retryable conflict on contention.
  - Add two mandatory core tables, `questpie_storage_cleanup` and `questpie_storage_object_key`. Every application with upload collections must generate and deploy the migration before its next upload metadata create/key change, even when purge and the durable cleanup worker are not enabled yet.
  - Preserve upload bytes through soft delete/restore. Replaced upload keys and committed purge now depend on the existing API/queue worker running the durable `storageCleanup` job; provider failures and crashes retain leased retry work. Hard-delete uploads remain post-commit but now use the same reference-aware key fence, and missing provider objects converge without leaking coordination rows.
  - Reject upload metadata creation or key replacement when the provider object does not exist, with a bounded provider existence check.
  - Integrate committed purge with audit, realtime, Search, and CRDT retention. Expired CRDT epochs, bindings, and the final retired identity tombstone are removed after the recovery window.
  - Preserve the original active-row `deletedAt` index and add a partial `(deletedAt, id)` index for bounded retention keysets.
  - Correct polymorphic relation persistence so public `{ type, id }` values map to both physical discriminator/id columns on create and update, reads and versions restore the public shape, and purge inspects every discriminator. Applications using polymorphic relations must review and deploy the generated schema migration, backfill legacy discriminator/id pairs, and verify that no retained reference has a null discriminator before enabling purge.
  - Keep framework-derived upload `key`, sanitized `filename`, MIME type, size, and configured visibility authoritative over `additionalData`; validate upload keys against the provider and relation targets against registered rows before writing. These checks add one bounded provider lookup or target-row lock to affected writes.
  - Make PostgreSQL queue `runOnce()` explicitly complete/fail fetched jobs and settle every fetched sibling before surfacing the first handler error.
  - Add a bounded high-water/keyset retention recipe, a relation-bearing real PostgreSQL benchmark harness, and a mandatory CI concurrency/key-reuse contract.

- [#188](https://github.com/questpie/questpie/pull/188) [`1a750e0`](https://github.com/questpie/questpie/commit/1a750e02a7c9eea7a52c035b009b78b79742961c) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Harden the starter authentication boundary.

  - Deny user-mode generic CRUD and introspection for Better Auth infrastructure
    collections while preserving system and Better Auth database operations.
  - Scope non-admin starter user CRUD to the current profile and reserve
    identity/authority fields for administrators.
  - Project only opaque owned session IDs from session listing and resolve them
    server-side for revocation, so reusable Better Auth bearer tokens never cross
    the list-sessions wire contract.

- [#188](https://github.com/questpie/questpie/pull/188) [`158ff0c`](https://github.com/questpie/questpie/commit/158ff0c58933a4b498191d99544222af134bea49) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Make upload-byte serving disclosure-safe and fail closed.

  - Compile filtered `serve` access through the canonical collection WHERE engine
    with full principal, actor, request, locale, and context-extension authority.
  - Re-check the exact current row, localization joins, relations, and soft-delete
    state before reading storage.
  - Return one not-found outcome for denied, absent, deleted, or invalid private
    signed-URL requests so file keys cannot be used as existence probes.

- [#188](https://github.com/questpie/questpie/pull/188) [`5c4804a`](https://github.com/questpie/questpie/commit/5c4804a8f45a34e3b8f20fc1210c2518f18e6f6a) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Make built-in Search authorization fail closed and capability reporting truthful. Search now requires explicit `.searchable(...)` opt-in, uses one canonical authorized source-row universe for hits, totals, facets, statistics, browse, and semantic ranking, rejects unimplemented hybrid mode, and fails the HTTP response when hydration no longer matches ranked candidates. The default projection is title-only, and hydrated HTTP/client results expose only the relevance score instead of index snapshots that could bypass field access.

### Patch Changes

- [#186](https://github.com/questpie/questpie/pull/186) [`b5c2b78`](https://github.com/questpie/questpie/commit/b5c2b78f274d444a0b63867d262025d2ebd592a9) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Collection engine hardening: transaction-scoped row locks, CRUD refactor, and a function-preserving deep-merge.

  - Add typed transaction-scoped collection row locks for cross-collection invariants.
  - Refactor the CRUD builder/generator with grouped-find result typing.
  - Replace `structuredClone` in `deepMerge` with a function-preserving `safeClone`, so app configs that hold callbacks (e.g. Better Auth `sendVerificationEmail`) merge without a `DataCloneError`.

- [#188](https://github.com/questpie/questpie/pull/188) [`875ae8c`](https://github.com/questpie/questpie/commit/875ae8c23fbdebd7e557a86ce4ee19c8c180d9aa) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Harden PostgreSQL realtime coordination and storage.
  - Bound and coalesce topology reconciliation work while exposing terminal reconcile outcomes.
  - Fence superseded reconnect streams so admission slots cannot leak or be reused to bypass per-principal limits.
  - Recover pg-notify listeners cleanly after a PostgreSQL connection terminates, and bound serialized NOTIFY work across shutdown.
  - Store realtime payloads, presence data, and desired topology as native JSONB with Bun SQL.
  - Replay exact SSE and Pusher topology after reconnect, bound dirty-notice queues with latest-wins reconcile semantics, and fence owner takeover with provider liveness checks.
  - Route targeted query and collaborative-document invalidations below an 8 KiB framework budget and 128-target cap, leaving serialization headroom beneath the provider's <10 kB ceiling and QUESTPIE's exact 10,000-byte application-event cap; overflow falls back to generic reconcile instead of dropping invalidation or creating a refresh herd.

## 3.16.0

### Minor Changes

- [#181](https://github.com/questpie/questpie/pull/181) [`ea5f109`](https://github.com/questpie/questpie/commit/ea5f1096009fec7818b0ffd6ae74412662a3ac6e) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add HA-safe Realtime v2 desired-topology control backed by Postgres leases, fencing, revisioned durable state, metadata-only broker wakes, and reconciliation. Rejected realtime topics now expose a safe, non-retryable `REALTIME_TOPIC_REJECTED` error to the exact client subscriber, and TanStack live queries enter a visible error state without retrying admission failures. Postgres apps now default to `PgNotifyChangeBroker`, with `redisStreamsChangeBroker` available as an explicit override. Legacy realtime adapters and rollout modes remain deprecated through QuestPie 3.x and are removed in QuestPie 4.

## 3.15.2

### Patch Changes

- [#176](https://github.com/questpie/questpie/pull/176) [`734737f`](https://github.com/questpie/questpie/commit/734737fd5a079c4063b6ff49f34fbacf01d8a2e8) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Always destroy the loaded app after migration CLI commands so production
  deployment init containers exit even when configured adapters keep event-loop
  resources open.

## 3.15.1

### Patch Changes

- [#170](https://github.com/questpie/questpie/pull/170) [`1e2691f`](https://github.com/questpie/questpie/commit/1e2691f6d2f310860bf81db2219f23dd4d122d10) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Always tear down the application after `questpie push` so adapter handles cannot keep deployment init containers running after the schema is applied. Keep the development-only warning visible with `--force`, and make generated project guidance explicit that production deployments must use committed migrations.

## 3.15.0

### Minor Changes

- [#163](https://github.com/questpie/questpie/pull/163) [`018dfb5`](https://github.com/questpie/questpie/commit/018dfb5b77039d0148a59d371062d08d1b89b691) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Ship Realtime v2 and typed application channels as one transport-agnostic realtime system.

  - Add transaction-bound realtime capture, durable reconciliation, resumable live-query topics, per-session refresh sharing, snapshot suppression, admission and backpressure limits, structured observations, and hardened pg-notify, Redis, and Cloudflare broker paths.
  - Add file-convention `channel()` definitions, generated server and client types, per-verb subscribe/publish authorization, Zod-validated events, ordered replay with explicit gap handling, and typed TanStack Query channel subscriptions.
  - Add transport-independent live presence with `subscribePresence()`, `presenceIter()`, and TanStack latest-roster queries; SSE uses cross-instance Postgres leases with principal aggregation and crash expiry, while Pusher/Soketi uses native provider membership behind the same client API.
  - Add the zero-infrastructure SSE preset and the optional Pusher/Soketi preset without changing consumer APIs, plus dynamic auth headers across data, upload, SSE, and WebSocket requests.
  - Add compatibility rollout modes, operational limits, migration and rollback documentation, reactive React performance guidance, cross-driver integration coverage, and existing admin/workflow consumer regression coverage.

  Migration note: bulk update and bulk delete now produce one logical realtime event per operation instead of one event per affected record. Adapter consumers must handle `bulk_update` and `bulk_delete` and use `payload.count` plus `payload.recordIds`. Follow the Realtime v2 migration guide for canary, dual-run, schema migration, and config-only rollback steps.

### Patch Changes

- [#167](https://github.com/questpie/questpie/pull/167) [`3e2dc5e`](https://github.com/questpie/questpie/commit/3e2dc5ed47b0b6fa279586d3ce3d27a2cc3154fb) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Preserve app-defined field value and operator types through `fieldType()`, and expose module-contributed collections in generated job and workflow handler contexts.

- [#166](https://github.com/questpie/questpie/pull/166) [`0fd1da3`](https://github.com/questpie/questpie/commit/0fd1da363e432653b8c45cef02ed867d3bf34d47) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Advertise OAuth protected-resource metadata at the actual MCP adapter mount path, including generated apps mounted under `/api`, and allow public MCP clients to complete dynamic client registration before the user signs in.

## 3.14.0

### Minor Changes

- [#125](https://github.com/questpie/questpie/pull/125) [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Admin UX overhaul (mobile + surfaces + relations + reactive fields) and a batch
  of framework fixes (custom field types, search reindex, migration snapshots,
  pg-boss singleton, time field).

  ## Admin

  **Surfaces & theming**

  - One canonical floating surface across every overlay — Drawer, Sheet, Command,
    Popover, DropdownMenu, Dialog, Select — a single `--popover` panel at the
    floating radius. Fixes select drawers that rendered a doubled background with
    double padding (the drawer's inset pseudo-panel + the Command painting its
    own panel), and drawers/sheets whose background token (`--background`) didn't
    match the menus' (`--popover`). Sheets slide in full-distance instead of
    fading (a translucent mid-fade read as two forms bleeding through each other),
    show their overlay scrim and are modal by default (resource editor, media
    picker, history sidebar, bulk upload).
  - Global search on mobile is one cohesive rounded sheet (was torn into
    square-cornered islands overflowing the drawer); keyboard-hint footer is
    desktop-only.
  - Sidebar logo accent follows `--primary` (whitelabel-aware) instead of a
    hardcoded brand purple, so a brand-override stylesheet retints it. The theme
    provider already toggles `.dark`/`.light` on `<html>` (default `system`,
    persisted); docs + the questpie-admin skill now document theme mode, the
    "never wrap the admin in a `.dark` div" portal gotcha, and mirroring
    base.css selectors (`:root,.dark` / `.light,:root.light`) for brand
    overrides. The barbershop example's whitelabel smoke-test is corrected to
    those selectors.

  **Menus (Base UI)**

  - Submenu triggers gate `openOnHover` on a hover-capable pointer, so on touch a
    tap reliably toggles a submenu open AND closed (default `openOnHover` meant a
    tap could only open, never close, and opening was racy). The sidebar user
    menu now uses proper nested submenus for theme / interface language / content
    language on mobile too, instead of a flat inline dump.

  **Reactive fields**

  - Field-level reactive admin props — `f.x().admin({ hidden / readOnly /
disabled: ({ data }) => ... })` — now actually apply. They resolve through
    `useReactiveProps` as component props; the field renderer was only reading
    reactive _field state_, so a `hidden` that evaluated to `true` on the server
    was silently ignored. The renderer now folds the resolved `hidden` /
    `readOnly` / `disabled` props into its visibility/interactivity.

  **Relations**

  - Multi-relation fields default to a compact Payload-style select control with
    the linked records as chips inside it (chip label opens the record editor,
    × unlinks, the menu shows linked options as checked and carries a pinned
    "Create new …" row). The `list` / `chips` / `table` / `cards` / `grid`
    layouts remain available via `display`; orderable relations keep `list` and
    now reorder by dragging a handle (dnd-kit, keyboard-accessible) instead of
    up/down buttons. Picker options show a secondary context line from the
    target collection's
    list columns. Per-item/per-option collection icons removed (the field label
    carries the icon once). Nested record editors (ResourceSheet) gained a
    context header ("Collection › Edit/Create"); the remove action uses a
    link-break icon to read as "unlink", not "delete".

  **Search**

  - Record search is consolidated into the global search (⌘K / top-bar), which
    now searches records across every collection with highlights; the per-table
    in-list search is off by default (a collection can opt it back in via
    `showSearch`). Internal OAuth/JWKS collections (`jwks`, `oauthAccessToken`,
    `oauthClient`, `oauthConsent`, `oauthRefreshToken`) are hidden from the admin
    — no longer leaking into global search or the sidebar.

  **Tables**

  - Auto-generated default columns show up to 6 short scalar fields (was 4) and
    skip wide/heavy types (richText, json, object, array, relation, upload, and
    now textarea) so tables read as populated rather than sparse without blowing
    out row height.

  **Misc**

  - Removed the redundant mobile Sort sheet (sorting lives in View Options).
  - Resource-sheet close button is centered in the header (was absolutely
    positioned and sat too low).
  - Array field empty state is just the dashed add button — no placeholder box
    stacked above a second full-width button.
  - Select primitives build their merged option map in a single pass (was an
    O(n²) Map clone per option on every keystroke).
  - Earlier mobile P0s: `h-dvh` shell (no dead strip / floating bottom bar when
    browser chrome collapses), coarse-pointer snap-back after iOS keyboard
    dismiss, checkbox tap-target no longer swallows taps.

  ## Framework (`questpie`)

  **Custom field types — first-class**

  - App-land `fieldType()` definitions work end to end: `questpie/builders`
    exports the operator sets a definition needs, generated factories merge field
    types discovered from the app's `fields/` directory into `f.*`, and emit them
    into the `Questpie.FieldTypesMap` augmentation so `f.<name>()` is first-class
    in the type system (not just wired at runtime). `@questpie/admin/client`
    exports `FieldWrapper` and `useResolvedControl` so custom admin field
    components get the same chrome as built-ins. The barbershop example ships
    `f.rating()` and a new `f.color()` swatch field (with a reactive
    `.admin({ hidden })`) as references. (Follow-up on the typesafety-unification
    branch: the app-field factory type is currently `Field<any>`, so a custom
    field's derived where/create types stay loose.)

  **Search reindex**

  - New app-layer `reindexCollection` / `reindexAllCollections` iterate a
    collection's records across every locale and rebuild the index (the search
    adapter's `reindex()` could only throw — it has no CRUD access). The
    `/search/reindex/:collection` route now uses it (was 500-ing), and
    `questpie seed` backfills the index after seeding — so seeded records are
    actually searchable (seeds run in a worker-less CLI, so the write-time index
    jobs were previously never processed and the index stayed empty).

  **Migration snapshots**

  - The migration generator builds the previous cumulative snapshot from the
    UNION of the on-disk `snapshots/*.json` chain (authoritative) and the
    in-memory migration list. Fixes a class of "re-emit an already-applied op"
    bugs (e.g. duplicate `ADD COLUMN` → "column already exists") when a
    codegen-produced migration list drifts out of sync with the snapshots on
    disk, and warns loudly when it does.

  **Queue (pg-boss)**

  - `singletonKey` now actually dedupes: a job (or publish) can declare a
    `queuePolicy` (`short` / `singleton` / `stately` / …), applied at queue
    creation — declaring it on the job definition means the worker's `listen()`
    and the web's `publish()` create the queue with the same policy. Policies
    only constrain keyed jobs, so non-keyed jobs keep full throughput. When a
    `singletonKey` is passed to a standard-policy queue (where pg-boss silently
    ignores it), the adapter warns once. (BullMQ already deduped via `jobId`.)

  **Fields & auth**

  - `f.time()` (default `withSeconds: true`) accepts both `HH:MM` and `HH:MM:SS`
    — the admin's native time input emits minute precision, which the previous
    seconds-required regex rejected, making time fields unsavable.
  - OAuth adapter glue (`resolveOAuthPrincipal`, well-known metadata proxies,
    legacy principal derivation) is properly typed against better-auth types
    instead of `as unknown as` casts; `/.well-known/oauth-authorization-server`
    answers 501 instead of crashing when the OAuth provider plugin is absent.

- [#125](https://github.com/questpie/questpie/pull/125) [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add optional connection-pool tuning to the `db: { url }` config via a new `pool` field (`DbPoolConfig`): `max`, `connectionTimeoutMs`, `idleTimeoutMs`, `maxLifetimeMs`, and `prepare` (Bun only, for PgBouncer transaction mode). Values are given in milliseconds and mapped to each driver's native unit — Bun `bun:sql` (seconds) and `node-postgres` (ms for acquire/idle, seconds for lifetime).

  Previously `db: { url }` created the pool with zero tuning (`new SQL({ url })` / `new pg.Pool({ connectionString })`), so it inherited driver defaults — notably node-postgres' `connectionTimeoutMillis: 0`, i.e. an unbounded wait to acquire a connection. On a shared Postgres running near its `max_connections` cap, that unbounded wait let a single request stall long enough to trip the SSR stream lifetime cap. Set a bounded `connectionTimeoutMs` so pool acquisition fails fast instead of hanging. Fully backward compatible: omit `pool` to keep the previous behavior.

- [#125](https://github.com/questpie/questpie/pull/125) [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add MCP-over-OAuth 2.1. An external MCP client can now connect to a QUESTPIE app purely via OAuth 2.1 (dynamic client registration → authorize + PKCE → consent → token → `POST /mcp`), authorized as `scopes ∩ RBAC`: out-of-scope tools are not even listed, and the user's `.access()` rules still apply.
  - **First-class request `principal`** (`user | oauth | system`) — an OAuth access token resolves to the underlying user, so existing RBAC keeps working, with consented scopes layered on top.
  - **Declarative granular scope catalog** — `collections:<name>:read|write|delete`, `globals:<name>:read|write`, `routes:<key>:invoke` (+ coarse `collections:*` umbrellas) DERIVED from the app's collections/globals/routes and merged into the provider at auth-instance build; the MCP scope gate derives its required scopes from the same source, so they never drift.
  - **EdDSA token-verify pinning** — access-token verification is pinned to the exact algorithm the provider issues, rejecting algorithm-substitution.
  - **Composable `oauthModule`** — the OAuth provider + OAuth tables are a self-contained module. `starterModule` bundles it (existing apps unchanged), and a custom-auth / headless (hono/elysia) app can add `oauthModule` on top of its own better-auth user model.
  - Root OAuth/MCP discovery endpoints (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`, `/jwks`); the HTTP `/mcp` route requires a verified principal (401 + `WWW-Authenticate`). Uses `@better-auth/oauth-provider` (replaces the deprecated `mcp` / `oidc-provider` plugins).

### Patch Changes

- [#125](https://github.com/questpie/questpie/pull/125) [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Codegen now recreates each target's output directory on every non-dry run, so generated files from a convention that was removed (for example `env.client.*` modules after deleting `env.client.ts`) no longer linger after regeneration.

- [#125](https://github.com/questpie/questpie/pull/125) [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92) Thanks [@drepkovsky](https://github.com/drepkovsky)! - The MCP HTTP endpoint is now expressed through the codegen route convention instead of a hand-written `module.ts`: one shared `mcpHandler` registered by four single-method route files (`mcp.ts` = POST, `mcp.get.ts`, `mcp.delete.ts`, `mcp.options.ts`) on the same `mcp` path. To support this, the codegen file convention now recognises `.options` and `.head` method suffixes (e.g. `mcp.options.ts` → route key `mcp:OPTIONS`), matching the existing `.get`/`.post`/`.put`/`.patch`/`.delete` handling.

## 3.13.0

### Minor Changes

- [#122](https://github.com/questpie/questpie/pull/122) [`9423a47`](https://github.com/questpie/questpie/commit/9423a47da757508935f192f73cc99b3ea7bac575) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add optional connection-pool tuning to the `db: { url }` config via a new `pool` field (`DbPoolConfig`): `max`, `connectionTimeoutMs`, `idleTimeoutMs`, `maxLifetimeMs`, and `prepare` (Bun only, for PgBouncer transaction mode). Values are given in milliseconds and mapped to each driver's native unit — Bun `bun:sql` (seconds) and `node-postgres` (ms for acquire/idle, seconds for lifetime).

  Previously `db: { url }` created the pool with zero tuning (`new SQL({ url })` / `new pg.Pool({ connectionString })`), so it inherited driver defaults — notably node-postgres' `connectionTimeoutMillis: 0`, i.e. an unbounded wait to acquire a connection. On a shared Postgres running near its `max_connections` cap, that unbounded wait let a single request stall long enough to trip the SSR stream lifetime cap. Set a bounded `connectionTimeoutMs` so pool acquisition fails fast instead of hanging. Fully backward compatible: omit `pool` to keep the previous behavior.

### Patch Changes

- [#122](https://github.com/questpie/questpie/pull/122) [`9423a47`](https://github.com/questpie/questpie/commit/9423a47da757508935f192f73cc99b3ea7bac575) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Codegen now recreates each target's output directory on every non-dry run, so generated files from a convention that was removed (for example `env.client.*` modules after deleting `env.client.ts`) no longer linger after regeneration.

## 3.12.0

### Minor Changes

- [#120](https://github.com/questpie/questpie/pull/120) [`2f6e776`](https://github.com/questpie/questpie/commit/2f6e776896a9381514a237447d4dcc85dad558d0) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Framework fixes bundled from the production-readiness work:
  - **Routes:** `executeJsonRoute` no longer crashes on an output-only route (a route declared with `.outputSchema()` and no `.schema()`, whose input is typed `unknown`) — it now passes the raw input through instead of calling `.parse` on an undefined input schema.
  - **Codegen:** app-level collections now override module-provided collections that share the same key, so a project can specialise a collection a module contributed without a key collision.
  - **Admin (audit):** the audit-log diff coerces `Date` and other non-JSON values into JSON-safe forms, so audit entries no longer fail to serialise on records containing dates or class instances.

## 3.11.0

### Minor Changes

- [#115](https://github.com/questpie/questpie/pull/115) [`fed686a`](https://github.com/questpie/questpie/commit/fed686a4a37a34a80783538c632e0597a4a98ec8) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Export `routeApp(ctx)` — the helper that resolves the app instance inside a `route().raw()` handler is now part of the public `questpie` API. External modules that register raw transport routes need it to reach the app without a deep import.

  This also unblocks serving multiple HTTP methods from one transport endpoint on a single path: since `route()` accepts one method, register the shared handler once per method using `"<path>:<METHOD>"` route keys (the same convention the core CRUD/auth routes use) — e.g. `"mcp:GET"`, `"mcp:POST"`, `"mcp:DELETE"`, `"mcp:OPTIONS"`. This restores loading of apps that register such endpoints (e.g. the MCP module).

### Patch Changes

- [#118](https://github.com/questpie/questpie/pull/118) [`4ed62ec`](https://github.com/questpie/questpie/commit/4ed62ec7375e7f841a20e7c36c11e15bc4f63b39) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Require `nodemailer` `^9.0.0` (resolved 9.0.1) to clear the high-severity raw-message file-access / SSRF advisory (GHSA-p6gq-j5cr-w38f). Only the optional SMTP mailer adapter consumes nodemailer, through its stable core API (`createTransport`/`sendMail`/`verify`), so the bump is transparent to apps.

- [#119](https://github.com/questpie/questpie/pull/119) [`7c4060d`](https://github.com/questpie/questpie/commit/7c4060df2fbc663cc9d4e718cff4ce72cdd83663) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add a field-level `not` where operator — a typed alias for `ne` (not-equal) on every scalar field type (text, number, boolean, date/datetime, select, relation id), where `not: null` maps to SQL `IS NOT NULL`. e.g. `{ where: { status: { not: "draft" } } }` or `{ where: { publishedAt: { not: null } } }`.

- [#116](https://github.com/questpie/questpie/pull/116) [`6cddd5b`](https://github.com/questpie/questpie/commit/6cddd5b2ec2127db40aa6b97212254689b9f780f) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Every user-code entry point now establishes the complete ambient `AppContext`, and lifecycle-hook contexts are self-documenting.

  **Ambient context (`AsyncLocalStorage`).** Queue/cron job consumers — and queue-dispatched scheduled workflow transitions — did NOT establish ambient context: the queue runner invoked job handlers without `runWithContext`, so the ALS store was empty in jobs. Ambient consumers silently degraded (logger trace, admin-audit actor), ctx-less CRUD lost session/locale, and an email sent from a job crashed with `collections is undefined` (the mailer resolves its template-handler args from the empty store). Jobs now run inside `runWithContext` at system scope, so `getContext()`, ctx-less CRUD (inheriting session/locale), and `email.sendTemplate(...)` all work from a job/cron exactly as they do in an HTTP request.

  **Admin server actions** previously received a hand-picked context that omitted `queue`/`email`/`storage`/`kv`/`services`, forcing a stage→`afterChange` workaround for side-effects. They now receive the full `extractAppServices` surface, and `ServerActionContext` extends `AppContextBase` (newly exported from `questpie`) so those services are typed.

  **New guarantee:** every user-code entry point — HTTP, CRUD + hooks, jobs/cron, seeds, admin widgets/prefetch, and admin actions — establishes the complete ambient context and hands handlers the full `AppContext`. The queue (listen/runOnce/push/cron) was the only entry point that didn't.

  Also in this release:

  - **Lifecycle-hook ctx is self-documenting.** The `afterChange` ctx is now a discriminated union on `operation`: `original` is absent on `"create"` and the non-optional previous row on `"update"` (it was `TSelect | undefined` on both, contradicting its own docs). `afterDelete`'s `original` is typed to the deleted row instead of `never`.
  - **`email.sendTemplate` honors `replyTo`** (it was silently dropped), and a contextless template handler that reaches for an app service now gets a clear, actionable error instead of a cryptic `collections is undefined`.
  - The framework no longer dogfoods the deprecated `update`/`delete` CRUD aliases internally — prefer `updateById`/`updateMany` and `deleteById`/`deleteMany`.

## 3.10.0

### Minor Changes

- [`d673da7`](https://github.com/questpie/questpie/commit/d673da7c463233222c8605851c9957cd2e90027d) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Make custom route calls use one canonical typed client shape: `client.routes.name.method(input)`.
  Route definitions now accept one HTTP method per builder; use method-suffixed route files for multiple methods on the same path.
  Route params inferred from method-suffixed keys now ignore the trailing `:METHOD`, so keys like `posts/[id]:GET` and `auth/[...path]:POST` keep their params.

  OpenAPI route generation now keeps operation and schema ids distinct for method-suffixed sibling routes that share one path.
  Docs and agent-facing examples now show only method-suffixed route files and method-leaf client calls.

  Normal `seed({...})` handlers now run inside a single database transaction, so failed writes and the seed tracking row roll back together. For resumable or side-effectful seed work, `seed.steps({...})` exposes `step(name, fn)`, stores completed step checkpoints in `questpie_seed_steps`, returns cached JSON results on replay, and clears checkpoints during force/reset/undo flows.

  The seed docs and Questpie skill references were updated to describe the new default transaction behavior, the `seed.steps()` API, checkpoint cleanup, and the no seed-wide rollback caveat for step seeds.

## 3.9.1

### Patch Changes

- [#111](https://github.com/questpie/questpie/pull/111) [`9e14122`](https://github.com/questpie/questpie/commit/9e1412231f18b40db2c87c1ce35dc352842b5cff) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Tighten scaffold conventions, generated app typing, and admin auth session inference.

## 3.9.0

### Minor Changes

- [#109](https://github.com/questpie/questpie/pull/109) [`835f985`](https://github.com/questpie/questpie/commit/835f98502bd98a2c2b3f34201ac6370f03105c93) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Run QUESTPIE on Node runtimes (e.g. Next.js), not just Bun.
  - **DB driver by runtime:** the `db.url` config now selects `node-postgres`
    (via the optional `pg` peer dependency) when running on Node, and keeps the
    native `bun:sql` driver on Bun. One `db.url` config works on both runtimes;
    Bun servers are unchanged.
  - **Extensionless codegen imports:** the generated `.generated/` layer files
    (`index → context.gen → entities.gen → names.gen`) now emit extensionless
    import specifiers instead of `.js`. Every supported bundler resolves these
    under `moduleResolution: "bundler"` (Vite, Bun, and — unlike the `.js` form —
    Turbopack/Next.js). Regenerate to pick up the new form; the old `.js` output
    keeps working until then.

## 3.8.0

### Minor Changes

- [#108](https://github.com/questpie/questpie/pull/108) [`b15ce41`](https://github.com/questpie/questpie/commit/b15ce41ce2ed8378abd0ea3e42c8f577abe9ad6b) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Deep type-safety campaign — break the codegen type cycles and make acyclicity structural.

  The generated `.generated/` output is now a strict one-way layered DAG (`names.gen.ts` → `entities.gen.ts` → `context.gen.ts` → `index.ts`), which makes the `AppContext⇄config` and `ctx → user-code` cycles impossible by construction. A new CI check (`check:codegen-layers`) enforces no-upward-import / no-cycle on the generated layers.

  Fixes:

  - Module-contributed collections that were re-declared across a module-nesting boundary (e.g. the admin module re-declaring starter's `user`) collapsed to `never` — so `collections.user.create()` had `never` inputs and a `{}` return. The module fold now OVERRIDE-merges same-key collection contributions instead of intersecting them.
  - `ctx.services.<other>` inside a service's `create()` no longer triggers a self-referential type cycle (routed through an ambient `Questpie.Services` registry + a flat per-key seam).
  - Per-category name registries (`Questpie.<Cat>Keys`) are now emitted for ALL discovered categories (routes/services/blocks/emails/views/components/field-types + collections/globals/jobs) via generic discovery, instead of a hardcoded collections/globals/jobs subset.

  Notes:

  - Types are tightened. After regenerating (`questpie generate`), you may see new type errors that surface previously-hidden bugs — this is intended.
  - The public `#questpie` import surface and the runtime API are unchanged; the layered split is internal to the generated output.

### Patch Changes

- [#106](https://github.com/questpie/questpie/pull/106) [`590e6c4`](https://github.com/questpie/questpie/commit/590e6c433a73a44316e89d00eeeaa21b0d584e3b) Thanks [@drepkovsky](https://github.com/drepkovsky)! - fix(cli): importing `questpie/cli` no longer executes the CLI. `program.parse()` is now guarded by `import.meta.main`, so it only runs when the CLI file is the process entry (the `questpie` bin or a direct `bun run .../exports/cli.ts`). Previously, a `questpie.config.ts` importing `packageConfig` from `"questpie/cli"` during `bun x questpie generate` loaded a second module instance (src vs dist) whose top-level parse started the same generate again concurrently, corrupting `.generated/module.ts` files (truncated output with NUL bytes). Codegen also writes generated files atomically now (temp file + rename), so concurrent or killed runs can never leave truncated output behind.

- [#103](https://github.com/questpie/questpie/pull/103) [`a56e017`](https://github.com/questpie/questpie/commit/a56e0179f6016915996e9bd9a58c7279d070692a) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Two fixes from jubli's 3.6.1 dogfooding:

  **`questpie push` no longer touches framework or foreign database state.** The diff scope is restricted to the app's own schemas and excludes the migration ledger (`questpie_migrations`); adapter-owned schemas (pg-boss) never enter the diff. A belt-and-suspenders guard additionally scans every PLANNED statement before `apply()` and aborts loudly if anything still targets framework/foreign objects — the previous behavior planned and executed `DROP TABLE questpie_migrations` and pg-boss drops when those objects entered the diff as "extras".

  **Function-valued rules in `appConfig({ access })` no longer collapse the AppContext augmentation.** Contextually-typed rule functions embedded the merged `AppContext` in `typeof config/app.ts`, which the generated index consumes — TS2456 across the whole app. App-level default access rules are now typed over the pre-codegen base context (`AppDefaultAccess` — `session`/`db` available, generated extensions deliberately not), and `appConfig()`'s return type erases `access`/`hooks` to opaque storage (the `CollectionAccessStorage` precedent) while preserving `locale` and the `context` resolver, whose annotated return keeps driving extension inference. Regression fixture: a function-valued default rule + global hook in toy-factory's app config now typechecks.

- [#107](https://github.com/questpie/questpie/pull/107) [`81e4922`](https://github.com/questpie/questpie/commit/81e4922e7ed54a2ff2171e86a9ce45a07b7c433b) Thanks [@drepkovsky](https://github.com/drepkovsky)! - **Realtime: concurrent `{ realtime: true }` / `live()` queries no longer cross-wire.** The client multiplexer derived each subscription's topic id from a hash truncated to 24 base64 characters. Because the normalized topic is key-sorted, that window only captured `{"resource":"` plus the first ~5 characters of the resource name — `where`/`with`/`limit`/`offset`/`orderBy`/`locale` never affected the id. Two live queries whose resource names shared a 5-character prefix (e.g. `events` and `event_members`), or that differed only in `where`, collapsed onto one id: the second topic was dropped from the subscription request, and the server's snapshot for the surviving topic was delivered to both queries — silently overwriting one query's data with the other's. Topic ids now encode the full normalized topic, so every distinct query gets a distinct id. This also fixes a latent crash on non-Latin1 `where` values (the browser path used `btoa()`, which is Latin1-only). Found dogfooding the Jubli guest feed.

## 3.7.0

### Minor Changes

- [#101](https://github.com/questpie/questpie/pull/101) [`029f036`](https://github.com/questpie/questpie/commit/029f036053039e73f9a97d1fe4785ef8c05771f4) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Wave A type quick wins — the probe-validated half of the type-supremacy audit.

  **Client & routes**

  - The routes client is typed end-to-end: `ExpandRoutes` is wired into `client.routes` (nested literal keys, phantom route names error) and the `& Record<string, any>` poison is gone. `AppConfig` no longer carries collection/global index-signature intersections — typo'd keys error on the client.
  - Route outputs are typed from `.outputSchema()`: it compile-checks the handler return and `InferRouteOutput<typeof def>` resolves through the definition (full handler-return inference deferred — a generic `.handler<TResult>()` provably re-enters the generated module graph; Wave B layered emission unblocks it).
  - `app: any` is gone from route handler args — `ctx.app` is fully typed via the AppContext augmentation (core module routes use an internal accessor).
  - @questpie/tanstack-query `find`/`findOne`/`get` are generic per call — results stop collapsing to `PaginatedResult<{}>`; global `columns` options are `Record<string, boolean>` instead of `any`.

  **Generated types**

  - Module codegen emits `type` aliases for category maps — module `interface` maps lacked implicit index signatures, failing the `Record` constraint and collapsing every `with`-populated relation to `{}` app-wide. Populated relations are real row types again (committed tripwire test guards the constraint).
  - Job/workflow contexts get typed `db`/`session`/`globals`/`kv`/`logger` members and a typed `workflows: WorkflowClient<AppWorkflows>` — bogus workflow names and wrong payloads error.

  **Field & input integrity**

  - `.default()` is constrained to the field's value type (`f.boolean().default("yes")` is now a compile error), field hooks receive typed values, and where-operator maps are sealed — unknown operators (`fuzzyMatch`, `eqq`) and wrong value types error instead of passing as `any`.
  - `create({})` errors again on collections without relations (the empty-relations fallback no longer optionalizes every key), and `columns: { x: false }` omission mode types the result correctly (it was inverted).

  **Type performance & CI**

  - Variance annotations on the hot field/CRUD aliases: flagship app check time drops ~13-30% (city-portal 10.6s → 7.4s) with byte-identical error sets.
  - New CI gates: `scripts/type-budget.ts` (instantiation budget per package/example, fails on >10% regression), `scripts/any-census.ts` (type-escape ratchet — counts can only go down), alongside the dist-types gate.

## 3.6.1

### Patch Changes

- [#99](https://github.com/questpie/questpie/pull/99) [`c8c4a84`](https://github.com/questpie/questpie/commit/c8c4a845b4f7442ff92123391b2636a9f15d9727) Thanks [@drepkovsky](https://github.com/drepkovsky)! - HOTFIX: the published 3.6.0 `.d.ts` broke declaration merging for every npm consumer — the dts bundler renamed `CollectionBuilder`'s type parameter to `TState$1` (name collision with a module-private `infer TState` in the same emitted file), so the generated `interface CollectionBuilder<TState extends CollectionBuilderState>` augmentation no longer merged (TS2428) and all collections degraded to `any` in published-package consumers. The colliding infer is renamed, and a new CI dist-types gate typechecks a real example against the BUILT `.d.mts` output (plus declaration-shape assertions on all augmentation-target classes) so dts-emit regressions of this class can never ship again.

## 3.6.0

### Minor Changes

- [#97](https://github.com/questpie/questpie/pull/97) [`13aad6f`](https://github.com/questpie/questpie/commit/13aad6f57cfd8a6678b7c34d3e33ea324f954a81) Thanks [@drepkovsky](https://github.com/drepkovsky)! - The 3.6.0 dogfooding batch — fixes and primitives surfaced by building a real app (jubli) on the framework.

  **Correctness**

  - `/health` no longer reports `search: degraded` forever — `SearchService.isInitialized()` exists now.
  - Multi-field `orderBy` applies every field (drizzle's `.orderBy()` replaces, so clauses are collected into one call); keyset pagination with tiebreaks is correct.
  - System timestamps use millisecond precision (`timestamp(3)`) — a `Date` you read equals the value stored; ms-boundary keyset cursors no longer skip rows.
  - Conditional updates are atomic: `update()`/`updateMany()` lock candidate rows and re-check the `where` inside the transaction, returning the winners array — parallel claims can no longer both succeed. `updateMany` is the canonical bulk name and unknown CRUD methods fail loud with suggestions instead of `undefined is not a function`.
  - `questpie push` works on the default bun-sql driver — driver results are normalized at one seam.
  - Server-side validation enforces field-level zod schemas (`.zod()` transforms, email format, select enums, array shapes) on create/update — previously they only drove admin forms and OpenAPI.

  **Access control**

  - Deny-all means deny-all: the `visibility: "public"` upload read short-circuit is gone. New `serve` access kind separates listing rows from fetching bytes by key (signed-token check for private files still always applies), and the new `introspect` kind gates `/{schema,meta}` through the normal access system.
  - Access rules are typed per operation: `create` rules get a typed `input`, `update`/`delete`/`transition` rules get a non-optional typed `data` (and `update` a typed patch `input`).

  **Composition**

  - `.fields()` on collections and globals is cumulative — it adds and overrides by key, never wipes builder state, so `collection("user").merge(starterModule.collections.user).fields(...)` keeps the whole starter model. `.merge()` preserves unresolved relation fields from both sides.
  - Typed field escape hatches: `.zod()` propagates the returned schema's output into the field's value type, `.$type<T>()` sets it explicitly with zero runtime effect, and `.drizzle()` remains the raw column hatch (constraints/defaults land in DDL) with `$type` propagation.

  **New primitives**

  - **Request context**: the `appConfig({ context })` resolver result travels with the request — typed and available in access rules, hooks, route handlers, field access, search, and `getContext()`.
  - **Env**: `env.ts` convention validates at boot (before adapters/auth/db init) with aggregate errors and framework base vars; `env.client.ts` + codegen emit per-bundler client env modules with literal `process.env.PREFIX_*` references — server keys are physically absent from client artifacts.
  - **Realtime client contract**: typed `live()`/`liveIter()` mirror `find()` typing on the client; `{ realtime: true }` is part of the public @questpie/tanstack-query types; the wire payload is a documented, stable contract.
  - **Infer-first types**: codegen auto-populates names-only key registries — `f.relation("…")` autocompletes collection keys (plain strings keep compiling). The generated index exports `AccessRuleContext<K>`, `HookRuleContext<K>`, `CollectionDoc<K>`, `GlobalDoc<K>`, `AppSession`, `AppSessionUser`, and `ctx.app` is fully typed on every handler context. `InferRouteInput/Output/Params` exported for tRPC-style standalone inference.

  **Codegen + teaching**

  - Codegen templates fixed: builder augmentations merge cleanly (identical type parameter lists), job handler `collections` typing no longer collapses in module graphs, and `.test.`/`.spec.`/`__tests__` files are never discovered as conventions.
  - Docs and the shipped skill teach all of the above — including the type-inference map (`references/type-inference.md`), Better Auth callback context facts, and ~20 previously undocumented primitives — with a repeatable skill-coverage gate (`scripts/skill-coverage.ts`).
  - All teaching examples use `relation("user")` (the starter key); the Better Auth anonymous-plugin recipe is documented.

## 3.5.6

### Patch Changes

- [#95](https://github.com/questpie/questpie/pull/95) [`ea701dd`](https://github.com/questpie/questpie/commit/ea701ddaa32f85056bbbcb7ba77099af349d6480) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Allow `runtimeConfig({ plugins: [...] })` results to be passed directly to `createApp` when TypeScript infers the plugins list as a readonly tuple.

## 3.5.5

### Patch Changes

- [#93](https://github.com/questpie/questpie/pull/93) [`24c0f0e`](https://github.com/questpie/questpie/commit/24c0f0edcc22dd21da3070139e96cb9bab7601e0) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fix minimal app scaffolding type output by collapsing empty module intersections, guarding workflow service context access, importing generated zod types through QuestPie public types, and accepting generated app instances in the Hono adapter.

## 3.5.4

### Patch Changes

- [#89](https://github.com/questpie/questpie/pull/89) [`4591b08`](https://github.com/questpie/questpie/commit/4591b08ff5f06196ea9303df2a5b0b08f9134c54) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Require an admin-role session for admin RPC routes that expose admin config, content locale callbacks, preview URLs/tokens, actions, widgets, and reactive field handlers, and document that the admin package depends on the Better Auth `session.user.role === "admin"` contract.

  Run block custom prefetch functions, `with` expansion, and loaders inside the caller request context so nested collection/global reads inherit the current session, locale, access mode, and workflow stage. Admin block introspection now serializes reactive field/form props and exposes only wire-safe block schema data instead of server-only callback state.

  Treat `inputFalse()`, `outputFalse()`, and field-level `.access()` declarations as framework-level runtime access primitives by resolving a single deterministic field access map for CRUD and introspection. Field `.access()` is the base rule, collection/global `.access({ fields })` can override it for compatibility, and `inputFalse()`/`outputFalse()` remain final deny rules. User-mode CRUD calls now reject restricted writes and redact restricted fields from collection/global responses, including nested object and array item paths. OpenAPI collection/global schemas now separate input and response shapes so read-only fields are not advertised as writable and write-only fields are not advertised as returned data.

  Stop synthesizing placeholder `Request` objects for local field hooks, field access, typed JSON routes, and admin reactive handlers. `req`/`request` is now present only for HTTP execution, so local API calls and workers can reliably distinguish non-HTTP execution from request-backed execution.

## 3.5.3

### Patch Changes

- [#83](https://github.com/questpie/questpie/pull/83) [`f678f70`](https://github.com/questpie/questpie/commit/f678f70121f8be87fd4a5be6a9b19a0ec3653d09) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Migrate QUESTPIE storage from Flydrive to the direct Files SDK API. Storage is now configured with `runtimeConfig({ storage: { adapter } })`, `app.storage` is the typed `Files` instance, and route, service, job, and hook contexts receive that same direct storage API.

  Remove the legacy `app.storage.use`, `storage.files`, `storage.driver`, Flydrive, DriveManager, QUESTPIE storage-disk, and storage-specific `createStorageRoutes()` closure surfaces. Upload CRUD cleanup and storage routes now call Files SDK operations directly, including streaming upload/download behavior and typed adapter access; `createAdapterRoutes()` remains as the broader deprecated compatibility shim.

- [#85](https://github.com/questpie/questpie/pull/85) [`ed73b91`](https://github.com/questpie/questpie/commit/ed73b917e4a1a59908e186171a4ab837edb3be9f) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add declarative admin list view filters, quick filters, filter-panel controls, system-field default sorting, and nested sidebar access filtering.

  Harden CRUD response field access, audit log route access, storage upload and private file serving, auth credential collection redaction, admin RPC authorization, admin action form validation, JSONB filtering, search access SQL generation, and upload file serving authorization.

  Harden global update auto-create races, nested field write access validation, Redis KV clearing, Postgres search query sanitization, admin widget/action caller context propagation, and frontend reactive hidden/read-only/disabled field state handling.

## 3.5.2

### Patch Changes

- [`bc0bc1d`](https://github.com/questpie/questpie/commit/bc0bc1dbfd24ddfa109218629fd97af52bcdf63e) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Preserve storage streams for upload and serve routes. Upload files can now be stream-only adapter inputs, storage writes keep explicit content length metadata, failed upload records clean up their written object, and collection file serving streams full and ranged responses without buffering the whole file.

  Restore the public QueueJobType type export used by generated queue client typings.

## 3.5.1

## 3.5.0

### Minor Changes

- [`1964037`](https://github.com/questpie/questpie/commit/196403736308b1bc8ff9309f4e1673f39bf3a972) Thanks [@drepkovsky](https://github.com/drepkovsky)! - fix(admin): fix broken toast i18n in action execution flow

  - Add missing `toast.processing` translation key to all 8 locale files
  - Forward server toast message through action dialog instead of showing generic fallback
  - Add `t` translation function to `ServerActionContext` for custom action handlers
  - Replace hardcoded English strings in user collection handlers with `t()` calls
  - Fix hardcoded strings in action-dialog.tsx and execute-action.ts

  feat(questpie): remove legacy `/storage/files/:key` alias route

  - File URLs now use collection-specific pattern: `/{collection}/files/{key}`
  - `buildStorageFileUrl()` accepts `collection` parameter (breaking change for direct callers)
  - Upload afterRead hook builds URLs directly instead of going through the storage driver
  - Remove `storage.collection` from `AdapterConfig`
  - Remove unused `generateFileUrl()` and `StorageUrlConfig`

## 3.4.1

### Patch Changes

- [`080da92`](https://github.com/questpie/questpie/commit/080da92a871df7f71263a3427145de9cd4fbdb58) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fix CLI binary not running — tsdown tree-shook the side-effect import

## 3.4.0

### Minor Changes

- [`42e0636`](https://github.com/questpie/questpie/commit/42e0636c8cf3dac1d2148878b4a76904a7b506b3) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Move concrete adapter implementations to dedicated `questpie/adapters/*` subpaths so optional adapter dependencies are not pulled into unrelated bundles.

  Add Cloudflare-compatible runtime infrastructure: custom Drizzle database configuration, lazy Bun SQL driver loading, Cloudflare Worker handlers, Queues/KV/realtime adapters, runtime compatibility validation, and Worker-oriented deployment docs.

  Emit required PostgreSQL search extensions in generated migrations before extension-backed indexes.

  Add built-in HTTP mailer adapters for Resend and Plunk with Resend-compatible API base URLs.

  Improve queue runtime compatibility and type safety. Queue clients expose jobs by registry key and literal name. Cloudflare Queues maps delayed jobs to platform `delaySeconds` and handles permanent errors deterministically.

  Harden durable workflows with database-backed per-instance lease and heartbeat renewal. Workflow admin/trigger routes default to logged-in admin access via `workflowsConfig()`. Stale execution leases are recovered by `wf-maintenance`.

  Improve admin form and table responsiveness. Reduce broad form subscriptions, scope table relation expansion to visible columns, and use compact default table columns. History sidebars include structured diffs for block, object, and array fields.

  Add `logAuditEntry` helper from `@questpie/admin/server` for custom audit events with actor overrides, resource metadata, locale, and structured changes.

  Fix admin server actions against the current runtime app shape. Action routes now resolve collection definitions through `app.getCollections()` and CRUD APIs through `app.collections`.

  Strip undefined values from admin config response before SuperJSON serialization.

## 3.3.0

### Minor Changes

- [`d0c97e8`](https://github.com/questpie/questpie/commit/d0c97e81c48acc107d5186c1c2407728a9aa0434) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Move concrete integrated adapter implementations out of the root `questpie` entrypoint and expose them through dedicated `questpie/adapters/*` subpaths. Adapter imports such as `pgBossAdapter`, `pgNotifyAdapter`, `redisStreamsAdapter`, `SmtpAdapter`, `ConsoleAdapter`, and BullMQ should now come from their adapter entrypoints. The root entrypoint keeps framework APIs, factories, interfaces, and shared types so optional adapter dependencies are not pulled into unrelated server or Worker bundles.

  Add Cloudflare-compatible runtime infrastructure for QUESTPIE apps. This includes custom Drizzle database configuration via `db: { drizzle }` and `db: { create }`, lazy loading for the default Bun SQL driver, Cloudflare Worker handlers for fetch/queue/scheduled entrypoints, Cloudflare Queues/KV/realtime adapters, runtime compatibility validation for explicit Cloudflare adapter configuration, FlyDrive S3/R2 deployment docs, and Worker-oriented docs for Hyperdrive, Queues, Cron Triggers, Durable Objects, KV, and storage.

  Emit required PostgreSQL search extensions in generated migrations before extension-backed indexes, so fresh databases can apply generated search migrations without manual `pg_trgm` or `vector` setup.

  Add built-in HTTP mailer adapters for Resend and Plunk, including support for Resend-compatible API base URLs.

  Improve queue runtime compatibility and type safety. Queue clients now expose jobs by both generated registry key and literal job name, so module code can publish internal jobs such as `questpie-wf-execute` without app-level alias wrappers. Cloudflare Queues now maps delayed jobs and retry delays to platform `delaySeconds`, handles permanent decode/handler errors deterministically, and respects retry limits from Cloudflare delivery attempts.

  Harden durable workflows. Workflow admin/trigger routes now default to logged-in admin access and can be configured through `config/workflows.ts` with `workflowsConfig()`. Workflow execution now uses a database-backed per-instance lease with heartbeat renewal, making duplicate queue deliveries idempotent across at-least-once queue runtimes. Stale workflow execution leases are recovered by `wf-maintenance`, and retry/cancel/timeout paths clear execution locks.

  Improve admin form and table responsiveness by reducing broad form subscriptions, scoping table relation expansion to visible columns, and using compact default table columns for unconfigured list views. Form sidebars now scroll more smoothly, and history sidebars include structured diffs for block, object, and array fields.

  Add a public `logAuditEntry` helper exported from `@questpie/admin/server` for writing custom audit events from jobs, actions, webhooks, and other server workflows. Audit entries now support actor overrides, resource metadata, locale, resource IDs, and structured changes. Audit log titles are localized at read time using the viewer locale, including localized action/resource labels and unnamed-resource fallbacks.

## 3.2.7

## 3.2.6

### Patch Changes

- [`40768c4`](https://github.com/questpie/questpie/commit/40768c4dc634dce6fa8c71ce1f23e0c7080ab1a9) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add first-class visual metadata (`icon`, `description`, `className`) to `f.select()` options. Options now flow end-to-end through introspection so the admin renders icons and tonal styling in cells, single/multi dropdowns, and selected-value chips without per-project cell overrides. Adds `c` (component callback proxy) to the fields callback context so `c.icon("ph:check-circle")` is in scope inside `({ f, c }) => f.select([...])`.

## 3.2.5

## 3.2.4

### Patch Changes

- [`ebee6b1`](https://github.com/questpie/questpie/commit/ebee6b161d46d2d6955d5c1839864bbc8d67cd69) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add the Questpie Cloud MVP CLI flow with validated login, project init, env import, dry-run deploys, deployment following, JSON output, and product-facing command errors.

## 3.2.3

### Patch Changes

- [`7607322`](https://github.com/questpie/questpie/commit/7607322cf6bbc0d933dd2c593edd3de618827b06) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add `questpie cloud login` and `questpie cloud init`, and let `questpie cloud deploy` use the saved Cloud profile.

## 3.2.2

### Patch Changes

- [`91d2a67`](https://github.com/questpie/questpie/commit/91d2a67a565593256032183dd1d9d960979376e8) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fix live preview focus scrolling for block and relation fields, and preserve array metadata during field introspection.

## 3.2.1

### Patch Changes

- [#57](https://github.com/questpie/questpie/pull/57) [`1174029`](https://github.com/questpie/questpie/commit/11740292c29c444adcdece8aa152f4c1eff2bdab) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Enhance the existing Preview flow with visual editing support, draft patch synchronization, inline scalar editing, block preview annotations, and block insertion affordances wired to the existing block editor.

  Update the barbershop example, documentation, scaffolder templates, and bundled QUESTPIE skills to describe and preserve the single Preview system architecture.

  Cache admin auth branding snapshots to avoid React update loops on login pages, translate select option labels consistently across admin tables and related UI, reduce hook recursion noise for legitimate nested read flows, resolve generated app output next to re-exported server configs for CLI commands, and add configurable request logging with request/trace id propagation and scoped application log correlation.

  The observability work provides a foundation without introducing OpenTelemetry tracing or exporter dependencies yet.

  Add a `questpie cloud deploy` command for submitting QUESTPIE project deploy requests to QUESTPIE Cloud.

- [#57](https://github.com/questpie/questpie/pull/57) [`f2b8496`](https://github.com/questpie/questpie/commit/f2b849642ffa2f9b37f429fac3a30377a9fd7851) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add a `questpie cloud deploy` command for submitting QUESTPIE project deploy requests to Questpie Cloud.

## 3.2.0

### Minor Changes

- [#28](https://github.com/questpie/questpie/pull/28) [`652f6b7`](https://github.com/questpie/questpie/commit/652f6b79e9a70004bc7318464e4ca1d7a4a5bead) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add `@questpie/workflows` — durable workflow engine for QUESTPIE.

  **Core Engine**

  - `workflow()` identity factory for type-safe workflow definitions
  - Replay-based execution engine with step caching and non-determinism detection
  - Step primitives: `step.run()`, `step.sleep()`, `step.sleepUntil()`, `step.waitForEvent()`, `step.invoke()`, `step.sendEvent()`
  - Duration parser (s/m/h/d/w), 5 error types, structured workflow logger

  **System Collections**

  - `wf_instance` — workflow instance tracking with status, input/output, timeout
  - `wf_step` — step execution records with replay memoization and match_hash index
  - `wf_event` — event persistence for JSONB-containment matching
  - `wf_log` — structured log entries queryable in admin UI

  **Events & Compensation**

  - Event matching engine with JSONB containment semantics (forward + retroactive)
  - Saga-pattern compensation with reverse LIFO order
  - Child workflow invocation with cascading timeouts
  - `onFailure` handler with `completedSteps` inspection

  **Cron Triggers & Retention**

  - `cron` field on workflow definitions for recurring execution
  - `cronOverlap` policy: `skip` (default), `allow`, `cancel-previous`
  - `RetentionPolicy` for automatic cleanup of old instances/steps/events/logs
  - `match_hash` optimization for O(1) event matching via FNV-1a indexed column

  **Workflow Client**

  - `trigger()`, `cancel()`, `getInstance()`, `getHistory()`, `sendEvent()`
  - `cancelAll()`, `retryAll()` batch operations
  - Idempotency key support, delayed start, parent-child relationships
  - Typed collection/global `transitionStage()` client calls now accept `scheduledAt`

  **Admin UI**

  - Workflow list page with status filters, auto-refresh, trigger dialog
  - Workflow detail page with step timeline, action buttons, log viewer
  - Dashboard stats widget showing active/completed/failed counts
  - Sidebar contribution for navigation

  **Docs & Type Safety**

  - Full durable workflow documentation with typed route, event, cron, admin, and client examples
  - Documented durable workflow instance and step lifecycle transitions with Mermaid diagrams
  - Expanded versioning workflow transition references across CRUD, global, hooks, and HTTP route docs
  - Mermaid architecture diagrams for workflow and docs architecture pages
  - Runtime workflow helpers and admin client routes are strongly typed without unsafe casts

  **Integration**

  - `workflowsPlugin()` codegen plugin for file-convention discovery
  - `workflowsModule` server module with collections, jobs, service, functions
  - `workflowsClientModule` for admin UI pages and widgets
  - Service at `ctx.workflows` via `namespace(null)`
  - `@questpie/admin/client` now exports `page()` and `PageDefinition` for module-provided admin pages

## 3.1.0

### Minor Changes

- [`6186dfb`](https://github.com/questpie/questpie/commit/6186dfbb7fd4423f4ee0c5b1af78f3690f433dfb) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fix save hanging on collections with blocks that use `.prefetch()`, fix custom actions disappearing after `CollectionBuilder.merge()`, and make form-state-dependent admin config (relation `filter`, etc.) actually work end-to-end.

  **merge() losing extension keys** — `CollectionBuilder.merge()` constructed its merged state from an explicit key list, silently dropping any keys added via `.set()` (e.g. `admin`, `adminList`, `adminForm`, `adminActions`, `adminPreview`). Custom actions defined on the source builder vanished after merge. Fixed by spreading both states before the explicit overrides.

  **Save deadlock with blocks prefetch** — `_executeUpdate` re-fetched updated records inside the open transaction, which triggered field output hooks (blocks `afterRead` → `prefetch()` functions). Those prefetch functions issued inner CRUD calls that inherited the tx connection via AsyncLocalStorage context propagation (`normalizeContext` resolves `db: context.db ?? stored?.db`). Under parallel load, all queries serialized through the single tx connection and Bun SQL deadlocked with the connection stuck `idle in transaction`. Fixed with a `skipOutputHooks` flag on `_executeFind` used for the in-tx refetch — output hooks already re-run after the tx commits.

  ***

  **Reactive admin props** — function-valued admin config (e.g. `f.relation("users").admin({ filter: ({ data }) => ({ team: data.team }) })` or layout `props.filter`) was silently dropped by introspection's `JSON.stringify` / `superjson.stringify`, the field component received `undefined`, and consumers like `relation-select`'s `if (filter) options.where = filter({})` short-circuited — making it look like the filter "worked" while returning every record.

  Function values now follow the same pattern as `hidden` / `readOnly` / `compute`: the function stays on the server, introspection emits a small placeholder, and the client resolves the value on demand against current form state.

  **Wire-level contract:**

  ```ts
  export type ReactivePropPlaceholder = {
    "~reactive": "prop";
    watch: string[]; // form paths the handler reads
    debounce?: number;
  };
  ```

  **Server.** `serializeFormLayoutProps` walks `state.adminForm.fields` (sidebar/tabs/sections too) and `serializeFieldMetaProps` walks every field's `metadata.meta`, replacing function or `{ handler, deps?, debounce? }` values with a `ReactivePropPlaceholder`. Static JSON passes through unchanged. Hooked into `introspectCollection` and `introspectGlobal`.

  **Server: `/admin/reactive` `prop` type.** `batchReactiveInputSchema.requests[].type` now accepts `"prop"` with a required `propPath`. The dispatcher resolves the original handler from layout `state.adminForm.fields[*].props[propPath]` first; if not found there, falls back to field-level `state.fieldDefinitions[fieldPath]._state.extensions.admin[propPath]`. So layout-level overrides field-level when both exist.

  **Client: `useReactiveProps` hook.** `FieldRenderer` calls a new `useReactiveProps({ entity, entityType, field, props })` hook over the merged `componentProps` — both field-level admin meta and layout-level `extraProps` go through it. The hook:

  - Returns static entries synchronously — no network.
  - Batches all placeholder entries into one `batchReactive` call.
  - Watches the union of `watch` deps via `react-hook-form` `useWatch`; refetches only when a tracked dep changes.
  - Debounces using `max(placeholder.debounce)` (default 100ms).
  - Caches under TanStack Query key `["questpie", "reactive-props", entityType, entity, field, propKeys, depHash]` with `placeholderData: prev` so consumers don't flicker on dep changes.

  **Type augmentation.** `RelationFieldAdminMeta.filter?: ReactivePropValue<Record<string, unknown>>` plus the same option key on every admin meta where it makes sense (object/array/etc.). `FormFieldLayoutItem.props?: Record<string, FormReactivePropValue<TData>>`. Removed dead `FieldLayoutItemWithReactive` from client builder — replaced with `FieldLayoutItemRef` mirroring the server post-serialization wire shape.

  **Recommended usage.** Field-level `.admin({ filter })` is the primary location — define once on the field, get the filter wherever the field renders. Layout-level `props.filter` is the per-instance override:

  ```ts
  // Field-level — primary
  counselorId: f.relation("users")
    .admin({
      filter: ({ data }) => ({ role: "admin", team: data.team }),
    })

    // Layout-level — per-instance override (wins over field-level)
    .form(({ v, f }) =>
      v.collectionForm({
        fields: [
          f.counselorId, // gets field-level filter
          {
            field: f.counselorId,
            props: {
              // overrides for THIS form
              filter: { role: "super-admin" },
            },
          },
        ],
      })
    );
  ```

## 3.0.9

## 3.0.8

## 3.0.7

### Patch Changes

- [#47](https://github.com/questpie/questpie/pull/47) [`5d7639b`](https://github.com/questpie/questpie/commit/5d7639b28d4625c5d587ad256cbac98ba14ff886) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fix three independent bugs in the CRUD + queue layer.

  **Race in `globals.<name>.get` auto-create.** Two concurrent `get(...)` calls against a fresh global both saw zero rows under READ COMMITTED and each inserted a "default-valued" auto-created row, leaving the database with two singletons. Auto-create now takes a transaction-scoped `pg_advisory_xact_lock(hashtext('questpie:global:<name>'))` and re-checks existence inside the locked transaction before inserting. Applied to both the workflow-versions branch and the plain branch. Schema-free — no migration. Backends without `pg_advisory_xact_lock` log a warning and fall back to the existence re-check.

  **Pre-stringified jsonb values stored as jsonb strings.** When upstream code (legacy seeds, RPC layers, custom hooks) handed an already-`JSON.stringify`'d array or object to `globals.<name>.update(...)` or `collections.<name>.create/update(...)`, Drizzle's jsonb `mapToDriverValue` stringified it a second time and Postgres stored a jsonb string instead of the intended array/object. The framework now normalizes input for jsonb-backed fields (`f.json()`, `f.object()`, `f.<x>().array()`, `f.blocks()`) before validation, hooks, and write — pre-stringified arrays/objects are decoded back to their plain JS values. Field input hooks always observe decoded values.

  **`pgBossAdapter` ignored pg-boss v10+ array callback shape.** pg-boss v10+ calls `work()` callbacks with `Job<T>[]` regardless of `batchSize`. The adapter destructured `job.id` / `job.data` straight off the array → both `undefined` → registered handlers received `payload: undefined` and every job failed Zod validation upstream. `listen()` now iterates the array, dispatches each job to the handler, and reports per-item failures via `boss.fail(jobName, id, …)` so siblings in the same batch still complete and the failed job retries independently. `runOnce()` already handled the array shape correctly via `fetch()` and is unchanged.

  All three fixes are backwards-compatible. No public API changes, no schema migrations.

## 3.0.6

### Patch Changes

- [#45](https://github.com/questpie/questpie/pull/45) [`ea2ff8d`](https://github.com/questpie/questpie/commit/ea2ff8dea8ad7b20946ed91906374e25a2bb9ba5) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Access functions receive `request`, no-op field writes are allowed, global forms auto-expand M:N, and form layout gains a `props` escape hatch.

  **`questpie` — access control:**

  - `AccessContext` now carries `request?: Request`. The HTTP adapter pipes the incoming `Request` through `app.createContext` into both collection and global CRUD evaluation, so collection/global `.access()` rules can branch on URL or headers (e.g. distinguish admin panel calls at `/admin/api/...` from public frontend calls at `/api/...`). Bound automatically — opt-in by destructuring `request` in your access function:

    ```ts
    read: ({ session, request }) => {
      const fromAdmin = request?.url.includes("/admin/api/");
      if (fromAdmin && isAdmin(session?.user)) return true;
      return { createdById: session?.user?.id };
    };
    ```

  - `validateFieldsWriteAccess` now skips fields whose value is unchanged on update. Forms (especially the admin's auto-generated form) re-submit `readOnly` fields with their original value; previously every save failed with `Cannot write field 'X': access denied` even though nothing changed. The check runs only when `existingRow` is available and uses `Object.is` for identity comparison.

  **`@questpie/admin`:**

  - `GlobalFormView` now auto-detects M:N relations via `detectManyToManyRelations` (parity with `CollectionFormView`) and requests them via `useGlobal(name, { with: ... })`. Upload-through and `relation().multiple()` fields on globals are now visible in the form instead of silently empty. Loaded relation arrays of objects are normalized to arrays of ids before the form resets, matching collection-form behavior.

  - New `createAdminClient<TApp>()` factory exported from `@questpie/admin/client` — wraps `createClient` and auto-injects an `X-Questpie-Admin: 1` request header on every outbound call. Use this for the client passed to `<AdminLayoutProvider client={...}>`; keep the public/frontend client as plain `createClient` (it must not inject the admin header).

    ```ts
    import { createAdminClient } from "@questpie/admin/client";
    import type { AppConfig } from "#questpie";

    export const adminCmsClient = createAdminClient<AppConfig>({
      baseURL:
        typeof window !== "undefined"
          ? window.location.origin
          : process.env.APP_URL!,
      basePath: "/api",
    });
    ```

  - New shared exports `isAdminRequest(request)`, `ADMIN_REQUEST_HEADER`, `ADMIN_API_PREFIX`, and `withAdminRequestHeader(fetch?)` from `@questpie/admin/shared`. `isAdminRequest` is the canonical access-rule guard — it checks the `X-Questpie-Admin` header first (set by `createAdminClient`), then falls back to the legacy `/admin/api/` URL prefix for back-compat:

    ```ts
    import { isAdminRequest } from "@questpie/admin/shared";

    read: ({ session, request }) => {
      if (isAdminRequest(request) && isAdmin(session?.user)) return true;
      return { createdById: session?.user?.id };
    };
    ```

  - `FormFieldLayoutItem` (server augmentation) and `FieldLayoutItemWithReactive` (client builder) gain `props?: Record<string, any>` — an escape hatch for component-specific configuration that doesn't have a dedicated layout key. Forwarded as extra props to the field component via the new `extraProps` slot on `FieldRenderer`. Use it for things like the relation field's `filter`:

    ```ts
    { field: f.counselorId, props: { filter: () => ({ role: "admin" }) } }
    ```

  No breaking changes: existing access functions ignore the new `request` field; layout items without `props` behave exactly as before.

  **Config-driven branding (name, logo, tagline, favicon) and admin.css-driven theming.**

  - `ServerBrandingConfig` now declares typed `logo` (`string | { src, srcDark, alt, width, height } | ComponentReference`), `tagline`, and `favicon` alongside the existing `name`. The DTO and Zod schema match — the previous `z.record(z.string(), z.any())` hole is closed and `branding.logo: any` becomes a real type.
  - `BrandingSync` hydrates all four fields into the admin store and applies the configured favicon to a managed `<link rel="icon">`. New `useBrand()` / `useBrandSnapshotRef()` hooks read the snapshot (safe outside `<AdminProvider>`).
  - New `<BrandLogoMark>` renders any of the three logo shapes with `.dark`-aware source switching. Sidebar and auth-page built-in fallbacks now render the configured logo, falling back to the legacy mark only when nothing is configured.
  - Auth pages: removed the hardcoded `brandName="QUESTPIE"` and the two `Built with QUESTPIE` strings; the auth tagline now renders the configured `tagline` (or nothing). Deduped the `logo={logo ?? <AuthDefaultLogo .../>}` fallback across 8 auth pages — `AuthLayout` resolves the default from the store.
  - New `--font-heading` CSS token (defaults to `var(--font-sans)`) applied to `h1`–`h6`, so apps can restyle headings without touching body type.
  - README: new "Whitelabeling" section with the two-layer model (config for content, `admin.css` for theme), OKLCH-first guidance, and the SSR-clean favicon recipe for TanStack Start.

  Backward-compat: file-convention overrides (`adminSidebarBrand`, `adminAuthLayout`) keep precedence over the new config-aware defaults; `AuthDefaultLogo`, `QuestpieSymbol`, and `selectBrandName` stay exported. Zero-config admin renders identically to before.

## 3.0.5

### Patch Changes

- [`325599e`](https://github.com/questpie/questpie/commit/325599e70089bcdeb632d0e389614e6738a514cb) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Expand bundled localization coverage across core and admin.
  - Add bundled validation translations for `cs`, `de`, `es`, `fr`, `pl`, and `pt`.
  - Extract backend/runtime errors, upload/storage, search, realtime, versioning, and database field errors into translatable messages.
  - Complete admin UI, server action, setup, preview, table, widget, and layout message catalogs for all bundled locales.

## 3.0.4

### Patch Changes

- [#41](https://github.com/questpie/questpie/pull/41) [`affb27e`](https://github.com/questpie/questpie/commit/affb27efff0837d181351793c5db3434e34616cb) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Prepare the next patch release across admin, core, scaffolding, and the Iconify Vite plugin.
  - Improve admin browser titles, metadata, dashboard widget sizing, form sidebar responsiveness, upload previews, localized validation messages, and file-first chrome/theme customization paths.
  - Add an admin-managed user avatar upload field backed by the assets collection while keeping Better Auth's `image` URL field compatible.
  - Expose a media upload sheet from upload-enabled collection list views.
  - Route admin server Drizzle imports through the `questpie` Drizzle re-exports so admin tests and published package consumers do not require a duplicate direct Drizzle resolution.
  - Improve migration and seed validation robustness, route/context propagation, and stricter CLI path/category/integer option parsing.
  - Harden project scaffolding with `.env` creation, non-interactive database/codegen/skills options, generated-project QUESTPIE agent skills, and fresh-app verification scripts.
  - Fix `@questpie/vite-plugin-iconify` package exports so the published package resolves to the built `dist/index.mjs` entrypoint with bundled declarations.

## 3.0.3

### Patch Changes

- [`e40fc20`](https://github.com/questpie/questpie/commit/e40fc200dbd604e2ad8147b4dd1711d11b968b91) Thanks [@drepkovsky](https://github.com/drepkovsky)! - `.drizzle()` escape hatch now propagates the column's `$type<T>()` to the field's inferred `data` type. If the returned column has a narrower typed data, the field picks it up; columns still typed as `unknown` leave the existing field `data` in place.

- [`acfc1c0`](https://github.com/questpie/questpie/commit/acfc1c0b94a2cde684d17ae50b2c4c2278d8705c) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add `schema?: string` option to collections and globals for placing tables under a named Postgres schema instead of `public`. Applies to all four table variants (main, i18n, versions, i18n_versions). `migrate:generate` emits `CREATE SCHEMA IF NOT EXISTS "<name>";` for new schemas and cross-schema relations render as `REFERENCES "other_schema"."table"("id")`. Unset (default) stays on `public` — fully backward-compatible.

## 3.0.2

### Patch Changes

- [`25b85ec`](https://github.com/questpie/questpie/commit/25b85ec54cfa7fdf38ee15548377d01191f0667a) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Improve generated app context inference from `config/app.ts` and add typed route params helpers for custom routes.

## 3.0.1

### Patch Changes

- [`fca6096`](https://github.com/questpie/questpie/commit/fca60967ee1c2b6b8fb439230e663daea60b0465) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Align v3 docs, generated app types, and the create-questpie starter template with the current file-convention and app API behavior.

- [`3e8e7e1`](https://github.com/questpie/questpie/commit/3e8e7e1f1b5b7fe05c58fd582d0ee6ced05c6411) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fix codegen discovery and generated app typing so typed collection exports, auth-backed session inference, and module tuples work without app-side hacks or manual generated-file edits.

## 3.0.0

### Major Changes

- [`202856b`](https://github.com/questpie/questpie/commit/202856bb3e7f17cb2898523f8911349f45686e78) Thanks [@drepkovsky](https://github.com/drepkovsky)! - # QuestPie v3

  Full v3 architecture redesign — module system, core module extraction, service definitions, route conventions, and type-safe field methods.

  ## Breaking Changes

  - **`QuestpieBuilder` removed** — `q()`, `.use()`, `.build()` chain replaced by file convention + `questpie generate`
  - **RPC module removed** — replaced by `routes/*.ts` directory with `route()` builder
  - **`app.api.*` removed** — use `app.collections` / `app.globals` direct getters
  - **Positional callbacks → destructured** — `.fields((f) => ...)` → `.fields(({ f }) => ...)`
  - **`contextResolver` removed** — session/locale are scoped CRUD context params
  - **`RegisteredApp` type removed** — use `typedApp<App>(ctx.app)` instead
  - **`fetchFn` → `loader`** on all dashboard widget types
  - **Secure-by-default access** — authenticated session required when no access rules defined
  - **Audit module opt-in** — `auditModule` must be explicitly added via `.use(auditModule)`

  ## New Features

  - **Module system** — core infrastructure (search, realtime, auth, queue) wired as formal service definitions
  - **`fieldType()` + `FieldWithMethods`** — type-safe field chain methods (`.manyToMany()`, `.trim()`, `.autoNow()`, etc.)
  - **Hook type safety** — fully typed `ctx.data` in collection hooks, no more `{ [x: string]: any }` fallback
  - **Route system** — file-path conventions, method-specific route definitions, priority matcher
  - **Workflow transitions** — `transitionStage()` with scheduled transitions, audit logging, admin UI
  - **Version history** — full versions/revert parity across stack with admin UI
  - **Server actions** — real form field mapping, RPC execution, effects handling
  - **Admin field meta augmentation** — all field types properly augmented with admin meta

## 2.0.0

### Major Changes

- [#16](https://github.com/questpie/questpie/pull/16) [`dd3ea44`](https://github.com/questpie/questpie/commit/dd3ea441d30a38705084c6068f229af21d5fd8d4) Thanks [@drepkovsky](https://github.com/drepkovsky)! - ## Ship field builder platform, server-driven admin, and standalone RPC API

  ### `questpie` (core)

  #### Field Builder System (NEW)

  Replace raw Drizzle column definitions with a type-safe field builder. Collections and globals now define fields via a callback that receives a field builder proxy `f`:

  ```ts
  // Before
  collection("posts").fields({
    title: varchar("title", { length: 255 }),
    content: text("content"),
  });

  // After
  q.collection("posts").fields((f) => ({
    title: f.text({ required: true }),
    content: f.textarea({ localized: true }),
    publishedAt: f.datetime(),
  }));
  ```

  Built-in field types: `text`, `textarea`, `number`, `boolean`, `date`, `datetime`, `time`, `email`, `url`, `select`, `upload`, `json`, `object`, `array`, `relation`. Each field produces Drizzle columns, Zod validation schemas, typed operators for filtering, and serializable metadata for admin introspection — all from a single declaration.

  **Custom field types** — define your own field types with the `field<TConfig, TValue>()` factory. A custom field implements `toColumn` (Drizzle column), `toZodSchema` (validation), `getOperators` (query filtering), and `getMetadata` (introspection). Register custom fields on the builder via `q.fields({ myField })` and they become available as `f.myField()` in all collections:

  ```ts
  const slugField = field<SlugFieldConfig, string>()({
    type: "slug",
    _value: undefined as unknown as string,
    toColumn: (name, config) => varchar(name, { length: 255 }),
    toZodSchema: (config) => z.string().regex(/^[a-z0-9-]+$/),
    getOperators: (config) => ({
      column: stringColumnOperators,
      jsonb: stringJsonbOperators,
    }),
    getMetadata: (config) => ({
      type: "slug",
      label: config.label,
      required: config.required ?? false,
      localized: false,
      readOnly: false,
      writeOnly: false,
    }),
  });

  // Register:
  const app = q({ name: "app" }).fields({ slug: slugField });
  // Use:
  collection("pages").fields((f) => ({ slug: f.slug({ required: true }) }));
  ```

  **Custom operators** — the `operator<TValue>()` helper creates typed filter functions from `(column, value, ctx) => SQL`. Each field's `getOperators` returns context-aware operator sets for both column and JSONB access. Operators are automatically used by the query builder and exposed via the client SDK's `where` parameter.

  #### Reactive Field System (NEW)

  Server-evaluated reactive behaviors on fields via `meta.admin`:

  - **`hidden`** / **`readOnly`** / **`disabled`** — conditionally toggle field state based on form data
  - **`compute`** — auto-compute values from other fields
  - **Dynamic `options`** — load select/relation options on the server with dependency tracking and debounce

  Reactive handlers run server-side with full access to `ctx.db`, `ctx.user`, `ctx.req`. A proxy-based dependency tracker automatically detects which form fields each handler reads and serializes that info to the client for efficient re-evaluation.

  #### Standalone RPC API (NEW)

  New `q.rpc()` builder for defining type-safe remote procedures outside collection/global CRUD. RPC procedures are routed through the HTTP adapter at `/rpc/<path>` with nested routers, access control, and full type inference on the client SDK.

  ```ts
  const r = q.rpc<typeof app>();
  export const dashboardRouter = r.router({
    stats: r.fn({
      handler: async ({ app }) => {
        /* ... */
      },
    }),
  });
  ```

  Collections and globals also support scoped `.functions()` for entity-specific RPC, routed at `/collections/:slug/rpc/:name` and `/globals/:slug/rpc/:name`.

  #### Callable `q` Builder

  The `q` export is now a callable builder: use `q({ name: "my-app" })` to create a fresh `QuestpieBuilder`, or access `q.collection()`, `q.global()`, `q.job()` etc. as methods. Default field types are auto-registered. Standalone function exports (`collection`, `global`, `job`, `fn`, `email`, `auth`, `config`, `rpc`) are are also re-exported.

  #### Introspection API (NEW)

  Full server-side introspection of collection and global schemas for admin consumption: field metadata, access permissions, relation info, reactive config, validation schemas — all serialized from builder state. Admin UI consumes this directly instead of relying on client-side config.

  #### Queue Runtime Redesign (BREAKING)

  - Redesigned `QueueService` with proper lifecycle (`start`/`stop`/`drain`), graceful shutdown, and health checks
  - New Cloudflare Queues adapter alongside pg-boss
  - Worker handlers now receive `{ payload, app }` instead of `(payload, ctx)`
  - Workflow builder API refined with better type inference

  #### Realtime Pipeline Hardening (BREAKING)

  - `PgNotifyAdapter`: proper connection lifecycle, idempotent `start`/`stop`, owned vs shared client tracking, handler cleanup
  - `RedisStreamsAdapter`: graceful error handling in read loop, no longer auto-disconnects client on `stop()`
  - `streamedQuery` from `@tanstack/react-query` integrated as first-class citizen in collection query options

  #### Access Control (BREAKING)

  - **Removed** `access.fields` from collection/global builder — field-level access is now defined per-field via `access: { read, update }` in the field definition itself
  - CRUD generator evaluates field-level access at runtime, filtering output and validating input per field

  #### CRUD API Alignment (BREAKING)

  - Client SDK `update`/`delete`/`restore` now accept object params `{ id, data }` instead of positional args
  - Relation field names are automatically transformed to FK columns in create/update operations
  - `updateMany` and `deleteMany` added to HTTP adapter, client SDK, and tanstack-query
  - Better Auth drizzle adapter now correctly uses transactions

  #### Server-Driven Admin Config

  Admin configuration (sidebar, dashboard, branding, actions) is now defined server-side and served via introspection. The server emits serializable `ComponentReference` objects (`{ type, props }`) instead of React elements. A typed **component factory** `c` is available in all admin config callbacks:

  ```ts
  // Server-side (serializable, no React imports):
  .admin(({ c }) => ({
    icon: c.icon("ph:article"),       // => { type: "icon", props: { name: "ph:article" } }
    badge: c.badge({ text: "New" }),   // => { type: "badge", props: { text: "New" } }
  }))
  ```

  The client resolves these references via `ComponentRenderer` which looks up the matching React component from the admin builder's component registry. Built-in components (`icon` → Iconify, `badge`) are registered by default; custom ones are added via `qa().components({ myComponent: MyReactComponent })`.

  ***

  ### `@questpie/admin`

  #### Server-Driven Schema (BREAKING)

  Admin UI now consumes field schemas, sidebar config, dashboard config, and branding from server introspection instead of client-side builder config. `defineAdminConfig` is replaced by server-defined metadata.

  #### Builder API Cleanup (BREAKING)

  - **Removed** from `qa` namespace: `qa.collection()`, `qa.global()`, `qa.block()`, `qa.sidebar()`, `qa.dashboard()`, `qa.branding()` — these are now server-side concerns
  - Kept: `qa.field()`, `qa.listView()`, `qa.editView()`, `qa.widget()`, `qa.page()` for client-only UI registrations
  - Admin `CollectionBuilder` and `GlobalBuilder` completely rewritten — all schema methods (`.fields()`, `.list()`, `.form()`) removed; only UI-specific methods remain (`.meta()`, `.preview()`, `.autoSave()`, `.use()`)

  #### Reactive Fields UI (NEW)

  - `useReactiveFields` hook evaluates server-defined reactive config (hidden/readOnly/disabled/compute) client-side with automatic dependency tracking
  - `useFieldOptions` hook for dynamic options loading with search debounce and SSE streaming

  #### Block Editor Rework

  - Full drag-and-drop block editor with canvas layout, block library sidebar, tree navigation
  - Block field metadata unified between collections and blocks
  - Block prefetch values inferred from field definitions

  #### Actions System (NEW)

  Collection-level actions system with both client and server handler modes:

  - **Handler types**: `navigate` (routing), `api` (HTTP call), `form` (dialog with field inputs), `dialog` (custom component), `custom` (arbitrary code), `server` (server-side execution with full app context)
  - **Scopes**: `header` (list view toolbar — primary buttons + secondary dropdown), `bulk` (selected items toolbar), `single`/`row` (per-item)
  - **Server actions** run handler on the server with access to `app`, `db`, `session`; return typed results (`success`, `error`, `redirect`, `download`) with side-effects (`invalidate`, `toast`, `navigate`)
  - **Form actions** accept field definitions from the field registry (`f.text()`, `f.select()`, etc.) for type-safe input collection in a dialog
  - **Confirmation dialogs** configurable per action with destructive styling support
  - Built-in action presets: `create`, `save`, `delete`, `deleteMany`, `duplicate`

  #### Realtime Multiplexor

  Migrated from example code into core admin package for SSE-based live updates.

  #### Test Migration

  All admin tests migrated from vitest to bun:test; vitest dependency removed.

  ***

  ### `@questpie/tanstack-query`

  #### RPC Query Options (NEW)

  Full type-safe query/mutation option builders for RPC procedures with nested router support. The `createQuestpieQueryOptions` factory now accepts a `TRPC` generic for RPC router types, producing `.rpc.*` namespaced option builders.

  #### Realtime Streaming (NEW)

  - Re-exports `buildCollectionTopic`, `buildGlobalTopic`, `TopicConfig`, `RealtimeAPI` from core client
  - Collection `.find`, `.findOne`, `.count` option builders produce `streamedQuery`-based options for SSE real-time updates

  #### Batch Operations (NEW)

  - `updateMany` and `deleteMany` mutation option builders for collections
  - `key` builders for all collection/global operations

  ***

  ### `@questpie/openapi` (NEW PACKAGE)

  OpenAPI 3.1 spec generator for QUESTPIE instances. Generates schemas for collections (CRUD + search), globals, auth, and RPC endpoints. Includes a Scalar-powered API reference UI mountable via the adapter.

  ***

  ### `@questpie/elysia` / `@questpie/hono` / `@questpie/next`

  - All adapters accept `rpc` config to mount standalone RPC router trees alongside CRUD routes
  - Formatting standardized (tabs → spaces alignment)
  - `@questpie/hono`: `questpieHono` now correctly forwards RPC router to fetch handler

  ***

  ### `create-questpie` (NEW PACKAGE)

  Interactive CLI (`bunx create-questpie`) for scaffolding new QUESTPIE projects. Ships with a TanStack Start template including pre-configured collections, globals, admin setup, migrations, and dev tooling.

## 1.1.1

### Patch Changes

- [`7172275`](https://github.com/questpie/questpie/commit/71722757a95e1f30521ac1eeca1080a8691bb9fc) Thanks [@drepkovsky](https://github.com/drepkovsky)! - fix: public uploads set visibility flag

## 1.1.0

### Minor Changes

- [`a7efd1e`](https://github.com/questpie/questpie/commit/a7efd1e7d8d5a9cc61de0f420d7d651df34c7002) Thanks [@drepkovsky](https://github.com/drepkovsky)! - feat: add defaultAccess for global access control defaults

  New `defaultAccess` option in CMS config sets default access rules for all collections and globals:

  ```typescript
  const cms = q({ name: "app" }).build({
    defaultAccess: {
      read: ({ session }) => !!session,
      create: ({ session }) => !!session,
      update: ({ session }) => !!session,
      delete: ({ session }) => !!session,
    },
  });
  ```

  - Collections/globals without explicit `.access()` inherit from `defaultAccess`
  - Explicit access rules override defaults
  - System access mode bypasses all checks

  ***

  feat: add getContext<TApp>() helper with AsyncLocalStorage support

  New typed context helper for accessing `app`, `session`, `db`, `locale`, and `accessMode`:

  **Explicit pattern** (recommended for hooks/access control):

  ```typescript
  .access({
    read: (ctx) => {
      const { session, app, db } = getContext<App>(ctx);
      return session?.user.role === "admin";
    }
  })
  ```

  **Implicit pattern** (via AsyncLocalStorage):

  ```typescript
  async function logActivity() {
    const { db, session } = getContext<App>(); // From storage
  }

  await runWithContext({ app: cms, session, db }, async () => {
    await logActivity(); // Works without passing context
  });
  ```

  CRUD operations automatically run within `runWithContext` scope, enabling implicit access in hooks.

  ***

  fix: properly handle access control returning false

  Fixed critical bug where access rules returning `false` were not properly enforced:

  - Added explicit `accessWhere === false` checks before query execution
  - Now throws `ApiError.forbidden()` with clear error messages
  - Applied to all CRUD operations (find, count, create, update, delete)
  - Realtime subscriptions now emit error events for access denied

  Previously, `false` was treated as "no restriction", potentially exposing data.

  ***

  feat: add many-to-many mutation support for globals

  Globals now support full many-to-many relation operations:

  - `connect` - Link existing records
  - `create` - Create and link new records
  - `connectOrCreate` - Connect if exists, create if not
  - `set` - Replace entire relation set
  - Plain array support `[id1, id2]` for admin forms

  Example usage:

  ```typescript
  // Connect existing services
  await cms.api.globals.homepage.update(
    {
      featuredServices: { connect: [{ id: service1.id }, { id: service2.id }] },
    },
    ctx
  );

  // Create new services and link them
  await cms.api.globals.homepage.update(
    {
      featuredServices: {
        create: [
          { name: "Consulting", description: "Expert advice", price: 100 },
        ],
      },
    },
    ctx
  );
  ```

  Also includes new test coverage for:

  - Junction table extra fields preservation
  - Empty relation handling
  - Cascade delete cleanup

  ***

  feat: add transaction utilities with `onAfterCommit` hook

  New AsyncLocalStorage-based transaction wrapper that solves deadlock issues and enables safe side-effect handling:

  ```typescript
  import { withTransaction, onAfterCommit } from "questpie";

  // In hooks - queue side effects for after commit
  .hooks({
    afterChange: async ({ data, context }) => {
      onAfterCommit(async () => {
        await context.app.queue.sendEmail.publish({ to: data.email });
        await context.app.mailer.send({ ... });
      });
    },
  })

  // In custom functions
  await withTransaction(db, async (tx) => {
    const order = await createOrder(tx);

    onAfterCommit(async () => {
      await sendConfirmationEmail(order);
    });

    return order;
  });
  ```

  Key features:

  - Callbacks only run after outermost transaction commits
  - Nested transactions automatically reuse parent tx
  - Safe for PGLite (single-connection) and production PostgreSQL
  - Ideal for job dispatching, emails, webhooks, search indexing

  ***

  fix: resolve PGLite test deadlocks in nested CRUD operations

  Fixed deadlock issues when CRUD operations with search indexing were called inside transactions (e.g., many-to-many nested mutations). Search indexing now uses `onAfterCommit` to run after transaction completion.

  ***

  refactor: remove jobs control plane (job_runs tracking)

  Removed the experimental `jobsModule` and `job_runs` collection tracking:

  - Simplified queue service and worker code (~400 lines removed)
  - Jobs now rely purely on queue adapter (PgBoss or other) for monitoring
  - Removed `jobsModule` export from package

  The jobs system remains fully functional:

  ```typescript
  const sendEmail = q.job("send-email", {
    schema: z.object({ to: z.string() }),
    handler: async ({ payload }) => { ... }
  });

  await app.queue.sendEmail.publish({ to: "user@example.com" });
  await app.listenToJobs();
  ```

  Control plane with admin UI visibility may be re-added in the future with a cleaner design.

  ***

  feat: add 6 new language translations

  Added i18n support for additional languages:

  **New locales:**

  - `cs` - Czech (Čeština)
  - `de` - German (Deutsch)
  - `es` - Spanish (Español)
  - `fr` - French (Français)
  - `pl` - Polish (Polski)
  - `pt` - Portuguese (Português)

  **Usage:**

  ```typescript
  const cms = q({ name: "app" }).build({
    locale: {
      default: "en",
      available: ["en", "sk", "cs", "de", "es", "fr", "pl", "pt"],
    },
  });
  ```

  All error messages, validation messages, and UI strings are now available in these languages.

## 1.0.5

### Patch Changes

- [`a043841`](https://github.com/questpie/questpie/commit/a0438419b01421ef16ca4b7621cb3ec7562cbec9) Thanks [@drepkovsky](https://github.com/drepkovsky)! - refactor: use cms.api.collections for CRUD operations

## 1.0.4

### Patch Changes

- [`01562df`](https://github.com/questpie/questpie/commit/01562dfb6771a47eddcb797f36f951ae434f29c8) Thanks [@drepkovsky](https://github.com/drepkovsky)! - feat: add Prettify to admin builder types and improve DX
  - Add `Prettify` wrapper to merged types in AdminBuilder for better IDE tooltips
  - Add default `ConsoleAdapter` for email in development mode (no config needed)
  - Fix package.json dependencies: move runtime deps (pino, drizzle-orm, zod) to dependencies, keep optional adapters (pg, ioredis, nodemailer, pg-boss) as optional peer deps

## 1.0.3

## 1.0.2

### Patch Changes

- [`eb98bb9`](https://github.com/questpie/questpie/commit/eb98bb9d86c3971e439d9d3081ed0efb3bcb1f77) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fix npm publish by converting workspace:\* to actual versions
  - Remove internal @questpie/typescript-config package (inline tsconfig)
  - Add publish script that converts workspace:\* references before changeset publish
  - Fixes installation errors when installing packages from npm

## 1.0.1

### Patch Changes

- [`87c7afb`](https://github.com/questpie/questpie/commit/87c7afbfad14e3f20ab078a803f11abf173aae99) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Remove internal @questpie/typescript-config package and inline tsconfig settings

  This removes the workspace:\* dependency that was causing issues when installing published packages from npm.

## 1.0.0

### Minor Changes

- [`934c362`](https://github.com/questpie/questpie/commit/934c362c22a5f29df20fa12432659b3b10400389) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Initial public release of QUESTPIE CMS framework.

## 0.0.2

### Patch Changes

- chore: include files in package.json

## 0.0.1

### Patch Changes

- feat: initial release
