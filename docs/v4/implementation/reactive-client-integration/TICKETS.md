# Reactive client integration tracer tickets

- Status: QRI-01 through QRI-05 complete; the production Query Resource,
  reference consumers, React projection, deletion, documentation, and release
  evidence are closed

These tickets implement Accepted ADR-0035 in dependency order. Each ticket is
an independently verifiable vertical slice. Agents start with the first
unblocked ticket and preserve one generated client and one Live Query kernel.

## QRI-01 — Generate and execute one Query Resource

### What to build

Drive one compiler-proven watchable Query from compiled watchability and codecs
through generated declarations, generated client code, canonical artifact
bytes, packed client execution, and one loopback Live Query. Add `.observe`
only to that method and implement the complete bounded Query Resource state and
lifetime contract. Do not add authoring metadata or a second transport.

### Acceptance criteria

- [x] Tests fail first for `.observe` presence/absence, exact inferred output,
      canonical input cloning, same-scope identity, cross-scope isolation,
      stable callables, independent subscription tokens, stale generations,
      complete replacement, reconnect retention, terminal recovery, 128-entry
      LRU behavior, retained eviction, and subscriber-fault containment.
- [x] Compiler output derives every member from existing watchability, Query
      identity, codecs, and Context scope; no duplicated parameter, description,
      key, invalidation, OpenAPI, MCP, or React definition is authored.
- [x] A packed generated client observes one real loopback watch while a
      one-shot-only Query has no `.observe` in types or runtime output.
- [x] Terminal failures and diagnostics disclose only closed codes; no fallback
      poller, one-shot call, retry loop, global cache, compatibility path, or
      second realtime kernel exists.
- [x] Focused compiler/client tests, strict type tests, package isolation,
      architecture, format/lint, and `git diff --check` pass.

### Blocked by

None — can start immediately.

## QRI-02 — Prove authority and lifetime in Collaboration

### What to build

Carry the production Query Resource through the Collaboration PostgreSQL 17 and
browser tracer. Exercise two Context and credential lifetimes, current Policy,
committed and rolled-back writes, reconnect, cancellation, capacity, eviction,
and subscriber failures through the real generated client and accepted Live
Query transport.

### Acceptance criteria

- [x] Byte-equal Context in different scopes never shares; replacing the Auth
      lifetime removes the old scope from the rendered application path.
- [x] Authority reset replaces complete output and authorization failure clears
      it without Policy, credential, input, result, endpoint, or stack detail.
- [x] Committed Change Ledger work publishes after fresh recomputation;
      rollback and zero-row work publish nothing.
- [x] Retained evicted handles cannot restart or delete replacements; duplicate
      callbacks remain independent; one subscriber fault cannot affect peers.
- [x] Last unsubscribe and browser cancellation stop owned watch/reconnect work;
      PostgreSQL containers, ports, hosts, and browser resources are cleaned.

### Blocked by

- QRI-01

## QRI-03 — Delete Team Support Desk reactive client duplication

### What to build

Replace Team Support Desk's request-generation guards, handwritten Live Query
loading/error records, late-delivery checks, and post-Mutation refresh fan-out
with production Query Resources while keeping all browser application traffic on
the generated client. Keep `const api = client.withContext(ctx)` as an ordinary
immutable iterative scope with no callback or disposal protocol.

### Acceptance criteria

- [x] Queue and detail screens render pending, ready, reconnecting, reset, and
      terminal states from Query Resource snapshots.
- [x] Mutations do not write or invalidate client state; committed watched
      Queries update through the Change Ledger and one-shot refresh remains
      explicit where still required.
- [x] The named duplicated guards, state records, late-delivery code, and refresh
      fan-out are deleted rather than hidden behind adapters.
- [x] PostgreSQL 17 and Firefox pass the beginner journey with exact generated
      types and no manual application request/response contract.
- [x] No callback-form Context API, `using`, `dispose`, global provider,
      application cache, fallback, or compatibility Resource is introduced.

### Blocked by

- QRI-01

## QRI-04 — Ship the React subpath projection

### What to build

Add the optional `questpie/react` export subpath to `questpie` with one inferred
`useQueryResource` hook over the production framework-neutral resource. Declare
React 19 as an optional peer of `questpie`, then carry the subpath through a
real Team Support Desk screen and Strict Mode lifetime tracer without moving
identity or cache ownership into React.

### Acceptance criteria

- [x] The hook calls exact
      `useSyncExternalStore(resource.subscribe, resource.getSnapshot)` and
      preserves the generated Query output union without caller generics.
- [x] Strict Mode subscribe/unsubscribe/resubscribe opens no concurrent watches
      and stops each final generation once.
- [x] The `questpie/react` subpath exports only the hook, pins the accepted
      React peer bound, and passes packed-install mismatch and package-isolation
      tests.
- [x] The `questpie` root, generated clients, and applications that do not
      import the subpath contain no React import.
- [x] The subpath contains no cache, transport, Context, credential, retry,
      invalidation, ReactDOM, TanStack, OpenTelemetry, SSR, Suspense, hydration,
      provider, fallback, or generated-application dependency.

### Blocked by

- QRI-02
- QRI-03

## QRI-05 — Close docs, deletion, and release evidence

### What to build

Verify the Accepted public Query Resource and discriminated-reference guide
against shipped declarations and packages. Delete the executable prototype and
duplicate tests after production parity, preserve only decision/history
evidence, and close the complete release-sensitive vertical.

### Acceptance criteria

- [x] Public examples use iterative `const api = client.withContext(ctx)` and
      inferred generated input/output; they repeat no Query parameters or
      projection metadata and claim no Context disposal semantics.
- [x] The discriminated reference recipe imports the exact three ADR-0037
      helpers and makes no Relation, codec, SQL, Policy, or Runtime
      polymorphism claim; QRI adds no duplicate implementation or alias.
- [x] Prototype runtime/test duplication and every obsolete fixture path named
      in the ADR deletion ledger are removed with no compatibility fallback.
- [x] Relevant PostgreSQL 17/browser tracers, package isolation, workspace
      types, docs types/build, architecture, `quality:release`, and two release
      dry-runs pass with clean resource cleanup.
- [x] Independent Standards and Spec reviews pass and `git diff --check` is
      clean before coherent closure commits.

### Blocked by

- QRI-04

## Blocking graph

```text
QRI-01 Query Resource core
  ├─> QRI-02 Collaboration hostile tracer ─┐
  └─> QRI-03 Team Support Desk deletion ──┴─> QRI-04 React subpath
                                                └─> QRI-05 release closure
```
