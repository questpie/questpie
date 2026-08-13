# V3 Context Resolution jobs and failure modes

- Status: research evidence; no v4 acceptance authority
- Evidence snapshot: local v3 tree at commit `11617485` (`v3.26.1`)
- Question: which jobs performed by request/app context resolution, identity,
  propagation, caching, and execution setup belong in the ideal v4 contract,
  independently of the v3 mechanisms?

All source and test citations below use `commit:path:line`. They can be
reproduced with `git show 11617485:<path> | nl -ba`. V3 is evidence only. This
report does not propose a v4 API and does not change the authority of `SPEC.md`,
`CONTEXT.md`, or an ADR.

## Result

V3's valuable idea was one resolved execution context shared by access rules,
hooks, routes, nested Collection calls, and request-scoped services. Its
request resolver also performed a real bootstrap job: it could use trusted
database reads to validate a tenant selected from untrusted request input, then
fail the request before ordinary authorization or business logic ran.

The mechanism did not form one coherent execution model. Resolution ran only
when a `Request` was present. A direct call without one, every Job attempt, and
therefore every Workflow attempt defaulted to total system access. Request
tenant, locale, Principal, and arbitrary derived facts did not follow durable
dispatch. Realtime retained the originally resolved context for Live Query
recomputation while Channel reauthorization explicitly rebuilt a fresh one.
V3 therefore proves the jobs are necessary and simultaneously proves that a
request-only flat extension callback plus ambient `accessMode` is not their v4
contract.

## Evidence ledger

| Evidence                                                                                         | What it establishes                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `11617485:packages/questpie/src/server/adapters/utils/context.ts:59-83,124-176`                  | HTTP ingress resolves credential identity/session and locale before calling the one app-context construction path; Auth resolution failure becomes an unauthenticated session.                 |
| `11617485:packages/questpie/src/server/config/questpie.ts:1008-1117`                             | `createContext()` selects defaults, derives Principal/access mode, runs the app resolver only when a Request exists, and stores its result as a flat object plus an internal extension bundle. |
| `11617485:packages/questpie/src/server/config/questpie.ts:1120-1188`                             | The resolver runs in a fresh scope with a system Principal and the full service surface, can query protected Collections, and warns when it returns reserved keys.                             |
| `11617485:packages/questpie/src/server/config/types.ts:747-802`                                  | The public intent was once-per-HTTP-request derivation with typed request/session/db plus codegen-augmented Collections, Globals, Queue, logger, and user Services.                            |
| `11617485:packages/questpie/test/context/request-context-extensions.test.ts:247-301,352-419`     | Tenant facts reach row/Field rules, hooks, `getContext()`, nested CRUD, and explicit-context direct calls; the resolver runs once, non-HTTP calls skip it, and re-entry is idempotent.         |
| `11617485:packages/questpie/test/context/request-context-extensions.test.ts:422-570`             | Resolver reads are isolated from caller ALS, run with system authority, retain safe request metadata, and restore the caller context after success or failure.                                 |
| `11617485:packages/questpie/test/context/request-context-extensions.test.ts:573-662`             | Reserved keys cannot shadow framework facts, and resolver failure aborts the request before an access rule runs.                                                                               |
| `11617485:packages/questpie/src/server/collection/crud/shared/context.ts:7-46,72-123`            | Nested CRUD inherits session, Principal, actor, db, access mode, locale, stage, and the extension bundle with explicit-over-ambient-over-default precedence.                                   |
| `11617485:packages/questpie/src/server/config/context.ts:123-153,197-250,291-312`                | V3 used AsyncLocalStorage as the ambient carrier and a separate request scope as the lifetime owner; `getContext()` merged extension values back into reads.                                   |
| `11617485:packages/questpie/src/server/config/context.ts:314-353`                                | Principal distinguished user, OAuth, and system identity, but collapsed runtime authority to the two-valued `user`/`system` access mode.                                                       |
| `11617485:packages/questpie/src/server/config/request-scope.ts:25-69,85-172`                     | Request services were memoized once per execution scope and disposed in reverse order after success or failure.                                                                                |
| `11617485:packages/questpie/test/integration/request-service-lifecycle.test.ts:19-79,279-331`    | One service instance is reused across a handler, an access rule, nested service calls, and standalone bound CRUD, then disposed at scope end.                                                  |
| `11617485:packages/questpie/src/server/adapters/http.ts:394-518`                                 | The HTTP adapter owns the request scope and completes context resolution before route execution.                                                                                               |
| `11617485:packages/questpie/src/server/routes/execute.ts:155-218,245-294`                        | Direct Route execution without an already resolved request context builds system context; HTTP execution propagates the resolved context into both access and handler calls.                   |
| `11617485:packages/questpie/src/server/collection/crud/crud-generator.ts:1679-1820`              | Create evaluates access, validation, and early lifecycle work using the resolved context before it opens the write transaction.                                                                |
| `11617485:packages/questpie/src/server/collection/crud/crud-generator.ts:4601-4639`              | The ordinary CRUD enforcement seam explicitly bypasses every access rule in system mode.                                                                                                       |
| `11617485:packages/questpie/src/server/collection/crud/shared/transaction.ts:315-355`            | The transaction is a separate ALS scope; nested calls reuse the outer transaction and callbacks run only after the outer commit.                                                               |
| `11617485:packages/questpie/test/context/create-context.test.ts:28-53`                           | A context with a Request defaults to user mode, while one without a Request defaults to system mode; either could be overridden explicitly.                                                    |
| `11617485:apps/docs/content/docs/guides/multi-tenancy.mdx:8-30,63-79,186-203`                    | V3 explicitly documented Tenant as request-derived state, not enforcement; each Collection needed its own rule and missing Tenant required an explicit decision.                               |
| `11617485:apps/docs/content/docs/guides/multi-tenancy/isolation-gaps.mdx:11-17,94-139`           | V3 documented silent isolation gaps: unscoped Relations, no-request system calls, `null` Tenant, and a create filter that was ignored.                                                         |
| `11617485:packages/questpie/src/server/modules/core/integrated/queue/service.ts:167-191,237-307` | Each Job attempt creates a fresh app scope and handler context, but hard-codes system access and does not reconstruct request-derived extensions or the dispatching Principal.                 |
| `11617485:packages/questpie/test/integration/queue-ambient-context.test.ts:11-17,48-69,126-159`  | The ambient Job scope fixed real failures in Job -> CRUD -> hook -> nested CRUD and Job -> mail-template chains, but the asserted authority is system.                                         |
| `11617485:apps/docs/content/docs/code/jobs.mdx:80-103`                                           | V3 documented that dispatching locale and caller identity do not travel with a Job; handlers skip access rules and must filter manually.                                                       |
| `11617485:packages/workflows/src/server/modules/workflows/jobs/wf-execute.ts:44-61,316-386`      | Workflow execution is a Queue Job; the Job context becomes the Workflow app context and internal persistence explicitly uses system mode.                                                      |
| `11617485:packages/workflows/src/server/engine/engine.ts:117-180`                                | The workflow handler receives that captured app context alongside replay/step state.                                                                                                           |
| `11617485:packages/questpie/src/server/adapters/routes/realtime.ts:477-504,1335-1351`            | Realtime admission evaluates normal Collection access with Principal, actor, request extensions, and the selected topic locale.                                                                |
| `11617485:packages/questpie/src/server/adapters/routes/realtime.ts:1531-1606,2077-2173`          | Live Query recomputation reevaluates access, but does so against the `topicContext` captured from the originally resolved request context.                                                     |
| `11617485:packages/questpie/src/server/adapters/routes/realtime.ts:1983-2015`                    | Channel subject reauthorization instead calls `refreshAdapterContext()` and rebuilds the Channels service from fresh session and app-context resolution.                                       |
| `11617485:packages/questpie/test/integration/realtime.test.ts:516-589,718-809`                   | Membership changes trigger relational-access recomputation, and session-scoped Live Query results keep row, Field, and output-hook results isolated by Principal.                              |

## Jobs actually performed by v3

### 1. Resolve credentials into trusted identity facts

HTTP ingress distinguished OAuth credentials from the ordinary Auth session
path. A valid OAuth token supplied a Principal carrying the real user and
scopes; a trusted system transport skipped OAuth resolution. Invalid or failed
session resolution fell through to no session rather than elevation
(`11617485:packages/questpie/src/server/adapters/utils/context.ts:124-176`).

The core Principal union separated `user`, `oauth`, and `system`, while the
legacy enforcement switch derived only `user` or `system` from it
(`11617485:packages/questpie/src/server/config/context.ts:314-353`). This is
positive evidence for a stable Principal independent of a specific Auth
library. It is negative evidence for treating a two-valued bypass mode as the
complete Authority model.

One ambiguity remained: `resolveSession()` caught every Auth error and returned
`null`, so invalid credentials, Auth-provider failure, and an anonymous request
were indistinguishable at this seam
(`11617485:packages/questpie/src/server/adapters/utils/context.ts:59-83`). V4
must decide which failures are declared ingress errors and which genuinely mean
anonymous Principal.

### 2. Select and validate a Tenant at a trusted bootstrap boundary

The canonical v3 example read an untrusted tenant header, queried membership,
and returned a derived `tenantId`
(`11617485:packages/questpie/src/server/config/types.ts:779-795`). The resolver
had deliberate system authority so it could read a membership Collection even
when that Collection denied every normal operation. The boundary test proves
that protected read succeeds while the ambient caller remains user-mode before
and after resolution
(`11617485:packages/questpie/test/context/request-context-extensions.test.ts:439-570`).

This performed two different jobs which v4 should keep separate:

1. select the immutable Tenant for this Execution; and
2. establish relational evidence that this Principal may act in it.

V3 often cached the second job as a boolean or role on the flat context. Its own
multi-tenancy guide correctly said deriving scope did not enforce it; every
tenant-owned Collection still required a row rule
(`11617485:apps/docs/content/docs/guides/multi-tenancy.mdx:28-34,186-203`).

### 3. Fail before authorization and handler execution

A derivation exception aborted the request before the Collection access rule
ran (`11617485:packages/questpie/test/context/request-context-extensions.test.ts:624-662`).
This is a durable job: unresolved or invalid execution facts must never degrade
to missing optional properties that accidentally broaden Policy.

V3 also isolated the privileged resolver from ambient user ALS and stale
extension values, then restored the caller after success and failure
(`11617485:packages/questpie/test/context/request-context-extensions.test.ts:485-569`).
The privileged bootstrap boundary therefore had a real non-leakage obligation,
not merely a convenient callback signature.

### 4. Freeze one resolved bundle for an HTTP request

Resolution was idempotent by presence of `~contextExtensions`: it ran only when
a Request existed and no bundle had already been attached
(`11617485:packages/questpie/src/server/config/questpie.ts:1086-1117`). Tests
pin one resolver run across rules, hooks, and nested CRUD, plus no rerun when a
resolved context re-entered `createContext()`
(`11617485:packages/questpie/test/context/request-context-extensions.test.ts:365-419`).

The same request could carry cheap cached lookup functions created in resolver
closure scope. The test's `expensiveTenant()` runs its underlying lookup once
even when several consumers call it
(`11617485:packages/questpie/test/context/request-context-extensions.test.ts:166-190,379-396`).
This proves demand for execution-local memoization. It does not prove that
arbitrary functions belong among immutable authorization facts.

### 5. Propagate caller facts into nested synchronous work

The normalizer's precedence was explicit value, nearest ALS value, then
default. It carried identity, database handle, locale, stage, and the extension
bundle into nested Collection calls
(`11617485:packages/questpie/src/server/collection/crud/shared/context.ts:72-123`).
The integration test proves a request-derived tenant reaches a create rule,
before-change hook, `getContext()`, and a nested audit-log create without manual
threading
(`11617485:packages/questpie/test/context/request-context-extensions.test.ts:275-301`).

That is a valuable parity job. Its mechanism was fragile: hidden ALS became an
authority source, so omission meant either caller inheritance or system access
depending on whether an ambient scope happened to exist. Explicitly passing
only `{ accessMode: "system" }` could also retain the ambient user's session and
other facts because partial overrides inherited everything else
(`11617485:packages/questpie/src/server/collection/crud/shared/context.ts:93-123`).

### 6. Own request-scoped Service caching and cleanup

V3 separated context values from execution lifetime. `RequestScope` memoized
one instance per Service name and disposed instances in reverse creation order,
including when execution and cleanup both failed
(`11617485:packages/questpie/src/server/config/request-scope.ts:25-69,85-172`).
The HTTP integration proves the same request Service instance is visible to a
Route, Policy-like access callback, and dependent Service
(`11617485:packages/questpie/test/integration/request-service-lifecycle.test.ts:19-79`).

This is positive evidence for an Execution-owned generated `ctx` and
deterministic disposal. It does not justify putting all Services into trusted
Context Resolution or making Service instances themselves immutable facts.

### 7. Bind database and transaction timing

The HTTP adapter resolved context before executing the selected Route
(`11617485:packages/questpie/src/server/adapters/http.ts:460-518`). In the
ordinary create path, access checks, validation, and early hooks ran before
`withTransaction()` opened the write transaction
(`11617485:packages/questpie/src/server/collection/crud/crud-generator.ts:1691-1820`).
The resolver therefore normally queried through the application database, not
the later Mutation transaction.

**Inference from that ordering:** a membership boolean or role cached by the
resolver could become stale before the transactional write and could not be
rechecked under the write's lock/snapshot merely because it lived on context.
There is no cited v3 test proving this race; the source ordering proves the seam
exists. V4 should keep immutable selected facts on Execution but evaluate
mutable relational authorization within the Policy/query transaction at the
required consistency point.

V3's transaction ALS did correctly reuse one outer transaction for nested work
and delay registered callbacks until successful outer commit
(`11617485:packages/questpie/src/server/collection/crud/shared/transaction.ts:315-355`).
The v4 job is transaction ownership and propagation, not a second ambient store
whose relationship to Execution must be inferred.

### 8. Give direct calls an explicit execution context

An explicit programmatic context made a direct Collection call use the same
tenant filter as HTTP
(`11617485:packages/questpie/test/context/request-context-extensions.test.ts:352-363`).
The generated standalone context factory also bound Collection and Service
calls back to one owned scope and required async disposal
(`11617485:packages/questpie/src/server/config/create-context-factory.ts:168-222`).

The unsafe default was equally explicit: no Request meant system access, and a
non-HTTP `createContext()` skipped custom resolution
(`11617485:packages/questpie/test/context/create-context.test.ts:28-53`;
`11617485:packages/questpie/test/context/request-context-extensions.test.ts:403-408`).
V3 docs warned that a bare backend call silently saw every tenant and told Jobs
to filter manually
(`11617485:apps/docs/content/docs/guides/multi-tenancy/isolation-gaps.mdx:94-106`).

The job worth preserving is a first-class direct Execution with explicit
Principal, Tenant, and Authority. The mechanism to reject is absence of a
Request as proof of System Authority.

### 9. Start every Job and Workflow attempt in a fresh scope

V3 Queue correctly created a new request/service scope per physical Job attempt,
validated the durable payload again, established ambient context for nested
calls, and correlated dispatch/idempotency identity
(`11617485:packages/questpie/src/server/modules/core/integrated/queue/service.ts:185-307`).
This fixed a production-shaped failure where a Job-triggered email template saw
`collections === undefined`, and it made Job -> CRUD -> hook -> nested CRUD
work as one scope
(`11617485:packages/questpie/test/integration/queue-ambient-context.test.ts:48-69,126-159`).

However, the attempt context hard-coded system access and reconstructed no
dispatching Principal, Tenant, request extensions, or locale. V3 documented
that caller locale did not travel and every handler saw everything
(`11617485:apps/docs/content/docs/code/jobs.mdx:89-103`). The Workflow engine
was implemented as such a Job, passed that Job context directly to the
Workflow handler, and repeatedly forced system access for persistence
(`11617485:packages/workflows/src/server/modules/workflows/jobs/wf-execute.ts:44-61,316-386`;
`11617485:packages/workflows/src/server/engine/engine.ts:171-180`).

The durable v4 question is therefore not “does ambient context propagate?” It
is “which authority does this durable intent declare, persist, re-resolve, and
audit on each attempt?” Worker attempts must never inherit ephemeral request
objects or Service instances, but they may need a declared run-as Principal /
Tenant reference, explicit System Authority, causation identity, or an
application-defined service Principal.

### 10. Reauthorize realtime work without cross-Principal leakage

V3 carried Principal, actor, request-derived extensions, and Relation-aware row
filters into realtime admission and every snapshot computation
(`11617485:packages/questpie/src/server/adapters/routes/realtime.ts:477-504,1531-1606`).
Tests prove both relational membership invalidation and isolation of row,
Field, and output-hook results between Principals
(`11617485:packages/questpie/test/integration/realtime.test.ts:516-589,718-809`).

But it had two refresh semantics:

- Live Query recomputation reevaluated the rule against the originally captured
  `topicContext` (`11617485:packages/questpie/src/server/adapters/routes/realtime.ts:1531-1606,2077-2173`).
- Channel subject reauthorization called `refreshAdapterContext()` and rebuilt
  session plus app-derived context
  (`11617485:packages/questpie/src/server/adapters/routes/realtime.ts:1983-2015`).

The source therefore demonstrates a split between “reevaluate Policy using
fresh database state” and “re-resolve credential/context facts.” V4 needs one
explicit revocation model: which Execution facts are frozen for a subscription,
which relational dependencies wake recomputation, when credentials/Principal
are re-resolved, and whether a changed Tenant closes the old subscription or
creates a new one.

## Failure modes to carry into v4 acceptance tests

### Derivation without enforcement leaks silently

Returning `{ tenantId }` did not scope any Collection by itself. An unscoped
Collection or Relation remained visible, a backend call without Request bypassed
rules, and `null` meant `IS NULL`, not deny
(`11617485:apps/docs/content/docs/guides/multi-tenancy/isolation-gaps.mdx:11-17,19-46,94-115`).
V4 needs compiler-visible Policy coverage and fail-closed missing facts rather
than relying on authors to remember the same callback everywhere.

### System Authority was inferred from transport absence

Both `createContext()` and nested CRUD defaulted to system when no Request/ALS
was available
(`11617485:packages/questpie/src/server/config/questpie.ts:1064-1084`;
`11617485:packages/questpie/src/server/collection/crud/shared/context.ts:89-123`),
and system mode returned allow before selecting any Collection/default rule
(`11617485:packages/questpie/src/server/collection/crud/crud-generator.ts:4601-4639`).
A refactor from HTTP to script or Job could therefore change authorization with
no change at the call site.

### Privileged Context Resolution exposed too much authority

The resolver intentionally received raw database, all Collections and Globals,
Queue, logger, KV, and user Services under system authority
(`11617485:packages/questpie/src/server/config/types.ts:747-777`;
`11617485:packages/questpie/src/server/config/questpie.ts:1142-1173`). This made
membership bootstrap easy, but also allowed unrelated writes, external effects,
Queue dispatch, and arbitrary Service behavior while merely constructing
identity facts. V4 should expose the smallest read-only bootstrap vocabulary
that earns its place.

### The flat extension object mixed facts, functions, and framework plumbing

V3 allowed arbitrary keys and values, including closure functions, then merged
them into every handler. Reserved names were protected only at runtime with
development warnings
(`11617485:packages/questpie/src/server/config/questpie.ts:97-126,1105-1117,1175-1188`).
The type system needed global augmentation, generated lazy seams, and special
cycle breakers to keep resolver -> AppContext -> config inference from
collapsing
(`11617485:packages/questpie/src/server/config/app-context.ts:80-113,208-219`).
This is direct negative evidence for a generic user-extensible context bag.

### Durable work lost caller scope while gaining total access

Job and Workflow attempts had fresh lifetimes but not fresh application identity
resolution. They used system access regardless of who dispatched the work
(`11617485:packages/questpie/src/server/modules/core/integrated/queue/service.ts:237-280`).
Manual tenant predicates were the only documented isolation mechanism. Retry,
replay, and nested workflow dispatch therefore depended on payload conventions,
not an inspectable Authority contract.

### Context-derived authorization could be stale at write time

Normal request resolution and create admission occurred before the write
transaction. Treating a resolver-produced membership/role as current Policy
evidence creates a time-of-check/time-of-use seam. This is an inference from
the cited ordering, not a claimed reproduced exploit. A hostile v4 test should
change membership between resolution and lock acquisition and prove the write
uses the required transaction-consistent decision.

### Realtime refreshed database evidence and credential evidence differently

Relational membership changes caused recomputation, but the Live Query callback
continued using the captured Principal/context while Channel subject
reauthorization rebuilt it. A v4 test matrix must separately cover membership
revocation, role/claim refresh, credential expiration, Tenant change, reconnect,
and cached-result invalidation.

## Keep the jobs, reject the mechanisms

These are research recommendations, not accepted decisions.

| Keep the framework job                                                                                | Reject the v3 mechanism                                                                             | V4 design pressure                                                                                                                         |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Resolve external credentials into a stable Principal before application work                          | Better Auth session shape as the core ABI; swallowing all Auth errors into anonymous                | Auth integration returns a declared Principal or declared ingress failure; core Policy remains Auth-library independent.                   |
| Select one immutable Tenant for an Execution                                                          | Raw header copied to `tenantId`; `null` flowing into row predicates                                 | Tenant selection is explicit, validated, typed, and distinct from membership proof.                                                        |
| Bootstrap membership safely when Policy cannot yet run                                                | Full system Collections/db/Queue/Services in an arbitrary callback                                  | A bounded read-only bootstrap or compiled relational resolution vocabulary with no external effects or ordinary writes.                    |
| Abort before Policy/handler when required execution facts fail                                        | Optional flat properties that consumers may forget to check                                         | Required generated facts are either present or Execution construction fails with a declared error.                                         |
| Keep Principal, Tenant, Authority, deadline, cancellation, locale, and trace stable for one Execution | `accessMode` inferred from presence/absence of Request or ALS                                       | Explicit Execution construction; System Authority requires a trusted capability and is never inferred from transport.                      |
| Give handlers one exact generated app `ctx`                                                           | Global `AppContext` augmentation, `any` fallbacks, reserved-name warnings, arbitrary extension bags | Compiler emits the concrete context for each app and execution kind; callback inference has one non-cyclic source.                         |
| Propagate facts and transaction to nested synchronous calls                                           | Ambient ALS as the user-visible source of authority                                                 | Runtime may use ALS internally, but semantic nested execution is tied to the explicit parent Execution/Transaction owner.                  |
| Memoize request/execution Services once and dispose them deterministically                            | Returning closure caches as authorization facts; exposing Service instances to Context Resolution   | Execution owns Service lifetime/cache; resolved authorization facts remain bounded immutable data.                                         |
| Evaluate mutable relational Policy at the correct snapshot/lock point                                 | Resolver-cached membership boolean reused before a later transaction                                | Selected facts freeze; database evidence remains a Policy dependency evaluated/rechecked transactionally.                                  |
| Support direct server calls with network-equivalent semantics                                         | No Request means total system bypass; per-call `{ accessMode: "system" }`                           | Generated direct API requires or creates an explicit Execution; trusted system execution is visibly different.                             |
| Start every Reaction/Job/Workflow attempt in a fresh owned scope                                      | Hard-coded system mode and loss of caller Tenant/Principal/locale                                   | Durable intent persists causation and an explicit authority strategy; each attempt reconstructs or re-resolves only durable facts.         |
| Reauthorize Live Query and Channel delivery over time                                                 | Live Query captured context versus Channel fresh context                                            | One documented freeze/refresh/revocation matrix, dependency invalidation, and no cross-Principal cache sharing.                            |
| Preserve direct/Fetch/realtime/worker/Studio Policy parity                                            | Transport-specific context keys and request URL branching                                           | Equivalent Principal/Tenant/Authority yields the same semantic decision; protocol metadata stays outside Policy unless explicitly modeled. |
| Keep privileged System Authority auditable                                                            | A two-valued string propagated and overridden ad hoc                                                | Authority is an immutable classified capability recorded in the Execution Envelope and unavailable from input.                             |

## Questions the v4 Context Resolution contract must close

1. Which ingress Definitions resolve credentials to Principal, and which errors
   mean anonymous versus unavailable/invalid Auth?
2. Who selects Tenant for Fetch, direct calls, Reactions, Jobs, Workflow steps,
   realtime reconnect, tests, CLI, and Studio?
3. Is membership entirely relational Policy, or is a bounded bootstrap fact
   required before Policy can query? If required, what read grammar prevents a
   privileged general-purpose handler?
4. Which generated `ctx` values are immutable Execution facts, which are
   request-scoped Services, which are transaction-owned data access, and which
   are Operation-local values?
5. When does resolution run relative to Query snapshot and Mutation
   transaction creation? Which database-derived facts must be recomputed after
   locking or on retry?
6. What is memoized per Execution, per transaction attempt, per realtime
   recomputation, per durable logical run, and per physical Job attempt?
7. What durable run-as strategies exist: explicit System Authority, service
   Principal, captured Principal reference, or re-resolved application
   Principal? Which are allowed for Reaction, Job, and Workflow?
8. Which facts cross a durable boundary as canonical values, which cross only
   as identity references, and which must never cross (Request, session token,
   db handle, Service instances, closures)?
9. For realtime, which facts freeze for a subscription, which invalidate its
   dependencies, which are periodically re-resolved, and which force reconnect
   or closure?
10. How do cancellation, deadline, trace, causation, transaction, dispatch,
    and attempt identities compose without several competing ambient stores?
11. Which hostile conformance tests prove no authority escalation when moving
    the same operation among Fetch, direct execution, nested work, realtime,
    worker, retry, restart, and Studio?

## Historical context

Several v3 commits show these were responses to real failures rather than a
single planned model:

- `5482506a` introduced request-sensitive `accessMode` defaults.
- `b15ce41c` introduced generated context seams and cycle breakers.
- `6cddd5b2` added ambient AppContext to Job entry points and the production
  mail-template regression proof.
- `9cc71406` isolated privileged resolver service access from caller ALS.
- `4db71e6e` added fresh provider-neutral Channel reauthorization.
- `465dfb37` fixed loss of snapshot context when no db was present.

Those fixes validate the jobs and the hostile cases above. Their accumulated
mechanisms are exactly what v4 should replace with one explicit Execution,
Context Resolution, Policy, Transaction, and durable-authority model.
