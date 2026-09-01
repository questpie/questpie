# Reactive client integration tracer tickets

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

- [ ] Tests fail first for `.observe` presence/absence, exact inferred output,
      canonical input cloning, same-scope identity, cross-scope isolation,
      stable callables, independent subscription tokens, stale generations,
      complete replacement, reconnect retention, terminal recovery, 128-entry
      LRU behavior, retained eviction, and subscriber-fault containment.
- [ ] Compiler output derives every member from existing watchability, Query
      identity, codecs, and Context scope; no duplicated parameter, description,
      key, invalidation, OpenAPI, MCP, or React definition is authored.
- [ ] A packed generated client observes one real loopback watch while a
      one-shot-only Query has no `.observe` in types or runtime output.
- [ ] Terminal failures and diagnostics disclose only closed codes; no fallback
      poller, one-shot call, retry loop, global cache, compatibility path, or
      second realtime kernel exists.
- [ ] Focused compiler/client tests, strict type tests, package isolation,
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

- [ ] Byte-equal Context in different scopes never shares; replacing the Auth
      lifetime removes the old scope from the rendered application path.
- [ ] Authority reset replaces complete output and authorization failure clears
      it without Policy, credential, input, result, endpoint, or stack detail.
- [ ] Committed Change Ledger work publishes after fresh recomputation;
      rollback and zero-row work publish nothing.
- [ ] Retained evicted handles cannot restart or delete replacements; duplicate
      callbacks remain independent; one subscriber fault cannot affect peers.
- [ ] Last unsubscribe and browser cancellation stop owned watch/reconnect work;
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

- [ ] Queue and detail screens render pending, ready, reconnecting, reset, and
      terminal states from Query Resource snapshots.
- [ ] Mutations do not write or invalidate client state; committed watched
      Queries update through the Change Ledger and one-shot refresh remains
      explicit where still required.
- [ ] The named duplicated guards, state records, late-delivery code, and refresh
      fan-out are deleted rather than hidden behind adapters.
- [ ] PostgreSQL 17 and Firefox pass the beginner journey with exact generated
      types and no manual application request/response contract.
- [ ] No callback-form Context API, `using`, `dispose`, global provider,
      application cache, fallback, or compatibility Resource is introduced.

### Blocked by

- QRI-01

## QRI-04 — Ship the exact-peer React projection

### What to build

Create the optional `@questpie/react` package with one inferred
`useQueryResource` hook over the production framework-neutral resource. Carry
it through a real React 19 Team Support Desk screen and Strict Mode lifetime
tracer without moving identity or cache ownership into React.

### Acceptance criteria

- [ ] The hook calls exact
      `useSyncExternalStore(resource.subscribe, resource.getSnapshot)` and
      preserves the generated Query output union without caller generics.
- [ ] Strict Mode subscribe/unsubscribe/resubscribe opens no concurrent watches
      and stops each final generation once.
- [ ] Package exports only the hook, pins exact QUESTPIE and React peer bounds,
      and passes packed-install mismatch and package-isolation tests.
- [ ] Core `questpie`, generated clients, and applications without the adapter
      contain no React import.
- [ ] The package contains no cache, transport, Context, credential, retry,
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

- [ ] Public examples use iterative `const api = client.withContext(ctx)` and
      inferred generated input/output; they repeat no Query parameters or
      projection metadata and claim no Context disposal semantics.
- [ ] The discriminated reference recipe exports no production helper and makes
      no Relation, codec, SQL, Policy, or Runtime polymorphism claim.
- [ ] Prototype runtime/test duplication and every obsolete fixture path named
      in the ADR deletion ledger are removed with no compatibility fallback.
- [ ] Relevant PostgreSQL 17/browser tracers, package isolation, workspace
      types, docs types/build, architecture, `quality:release`, and two release
      dry-runs pass with clean resource cleanup.
- [ ] Independent Standards and Spec reviews pass and `git diff --check` is
      clean before coherent closure commits.

### Blocked by

- QRI-04

## Blocking graph

```text
QRI-01 Query Resource core
  ├─> QRI-02 Collaboration hostile tracer ─┐
  └─> QRI-03 Team Support Desk deletion ──┴─> QRI-04 React adapter
                                                └─> QRI-05 release closure
```
