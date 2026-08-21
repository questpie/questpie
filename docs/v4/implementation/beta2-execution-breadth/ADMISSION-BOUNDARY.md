# Operation admission boundary before Route and Action

- Status: selected candidate for a focused proof; not acceptance authority
- Scope: finish DX-01, reconcile credential ingress, and unblock EB-02 without
  adding a core Auth product
- Authority: ADR-0015, ADR-0023, ADR-0026, `SPEC.md`, and the accepted
  Collection Policy contract
- Non-goals: an ADR projection, a Better Auth dependency, Collection Policy
  redesign, Query authoring convergence, Route matching, or Action execution

## The blocking mismatch

Three accepted requirements meet at a seam that the current Runtime cannot
represent coherently.

1. A Route owns compiler-projected admission metadata. Network ingress resolves
   credentials, direct invocation supplies a Principal, and zero credential
   resolvers produces the anonymous Principal
   (`docs/adr/0015-freeze-service-route-and-auth-composition.md:30`-`:47`).
2. Action owns Policy and must distinguish provider rejection from an unknowable
   external outcome without automatic retry
   (`docs/adr/0026-freeze-action-and-unify-checkpointed-work-in-job.md:35`-`:53`).
3. Policy is the only product authorization model, but a Policy Resource is
   necessarily bound to one Collection: its public target is
   `` `collection:${string}` `` and `definePolicy` takes the Collection as its
   first argument (`packages/questpie/src/relational/policy.ts:102`-`:133`).

The runtime already has the correct small admission evaluator. It accepts only
`authenticated`, `public`, or `system`, and produces distinct internal
`unauthenticated` and `forbidden` failures before application work
(`packages/runtime/src/operation/index.ts:61`-`:84`). The application wrapper
cannot preserve those outcomes: its framework failure union contains neither
code (`packages/runtime/src/operation/index.ts:41`-`:49`), unknown errors become
`INTERNAL` (`:86`-`:96`), and the HTTP status mapping has no 401 or 403 outcome
(`packages/runtime/src/operation/wire.ts:143`-`:153`).

Credential ingress has a second mismatch. Generated application code fixes
`resolvePrincipal` to `readIngressPrincipal`
(`packages/compiler/src/runtime/application.ts:270`, `:328`-`:333`). That
function returns `null` when no trusted host binding exists
(`packages/runtime/src/operation/ingress.ts:3`-`:16`), and the Fetch wrapper
turns the absence into `NOT_FOUND`
(`packages/runtime/src/application/index.ts:518`-`:525`). Accepted behavior is
the opposite: absence of a resolver produces anonymous, while provider failure
is typed and cannot silently downgrade to anonymous (`SPEC.md:368`-`:373`).

This is one boundary, not three unrelated fixes. Route and Action must reuse a
completed Operation admission kernel; adding either first would force it to
invent authorization or preserve a wire result known to be wrong. The execution
queue already makes that ordering explicit
(`docs/v4/implementation/beta2-execution-breadth/DX-PASSES.md:121`-`:138`).

## Selected candidate

### Authored vocabulary

Use an `admission` property on non-Collection Operations, with the existing
restricted Policy expressions as values:

```ts
export const webhook = defineRoute({
	name: "billing.webhook",
	method: "POST",
	path: "/webhooks/billing",
	admission: policy.public(),
	// ...
});

export const publish = defineAction({
	name: "messages.publish",
	admission: policy.authenticated(),
	// ...
});
```

`admission` names the phase owned by the Operation. `policy.*` remains the one
authored authorization grammar. This does not create a second Policy Resource:
the compiler accepts only the zero-operand `policy.public()` and
`policy.authenticated()` expressions at this property and normalizes them to the
existing closed admission values. A Collection-bound `PolicyDefinition`,
`policy.exists(...)`, `policy.rows(...)`, and arbitrary Boolean expression fail
at the authored Origin.

This is a **judgment call**, not an accepted spelling. It is preferred over
`policy: ...` because `policy` already names the complete Collection-bound
Resource and its row, input, candidate, and output phases. It is preferred over
bare strings or a new `auth.*` namespace because either would create a second
authored authorization vocabulary. The current DX wayfinder independently
identifies `admission` as the leading candidate but requires a focused proof
before projection (`docs/v4/implementation/beta2-execution-breadth/DX-PASSES.md:187`-`:193`).

This decision does not add the property to named Query during EB-02. Named Query
authoring and Query/Mutation one-source convergence remain DX-02 work. The proof
below must nevertheless show that the same normalized admission value reaches
the already-existing Query, Mutation, Route, and Action execution adapter; it
may not create a Route-only evaluator.

### Credential resolution

Ingress has exactly these outcomes:

| Configuration or result                                     | Runtime Principal/outcome                            |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| no credential resolver                                      | trusted anonymous Principal                          |
| resolver returns anonymous                                  | trusted anonymous Principal                          |
| resolver returns resolved                                   | exact trusted returned Principal                     |
| resolver reports invalid or absent credentials as anonymous | admission decides the result                         |
| resolver reports provider failure                           | typed credential-resolution failure; never anonymous |

The resolver remains bound to one explicit application-lifetime external
Service. It decides none of Tenant, Context, Policy, or Authority, matching the
accepted ownership boundary
(`docs/adr/0015-freeze-service-route-and-auth-composition.md:44`-`:52`). The
current Request `WeakMap` may remain a trusted test or embedding seam, but it is
not the zero-resolver implementation and is not a credential resolver.

### Direct and network outcomes

Select three framework outcomes for the proof:

| Internal disposition                   | Direct result             | Operation Wire result                        | HTTP |
| -------------------------------------- | ------------------------- | -------------------------------------------- | ---- |
| anonymous at `authenticated` admission | `UNAUTHENTICATED`         | `UNAUTHENTICATED`, `retryable: false`        | 401  |
| ordinary caller at `system` admission  | `FORBIDDEN`               | `FORBIDDEN`, `retryable: false`              | 403  |
| credential provider failure            | `CREDENTIALS_UNAVAILABLE` | `CREDENTIALS_UNAVAILABLE`, `retryable: true` | 503  |

These are framework/ingress failures, never authored declared errors. They
carry no credential bytes, provider error, Policy evidence, stack, Tenant, or
serialized Context. `CREDENTIALS_UNAVAILABLE` says only that identity could not
be resolved reliably; it does not claim the Runtime itself is unavailable.

This is also a **judgment call**. Mapping every denial to `NOT_FOUND` would keep
the current wire bytes but would erase the already-typed distinction between an
anonymous caller and insufficient Authority. Mapping it to `INTERNAL` is already
rejected by the DX wayfinder because it hides an enforced application outcome
(`docs/v4/implementation/beta2-execution-breadth/DX-PASSES.md:159`-`:165`).
Reusing `RUNTIME_UNAVAILABLE` for an Auth-provider outage would misname the
failure owner and prevent callers from distinguishing a healthy application
from an unavailable credential dependency.

Accepted Operation Wire v2 cannot be silently expanded. ADR-0023 preserves the
exact earlier wire bytes and requires a new digest to select a revised contract
(`docs/adr/0023-freeze-post-commit-operation-outcome.md:21`-`:28`, `:39`-`:50`).
The candidate therefore creates a sibling exact wire contract and digest. The
carrier protocol and media type need not change merely because the digest does
not match, following the v1-to-v2 precedent. An older retained pair is refused
with its readable `CLIENT_OUTDATED` result before credential resolution whenever
it cannot represent a possible admission result. It is never allowed to execute
and then receive a code outside its contract.

Raw Route Fetch is not Operation Wire. Before its handler, the same semantic
dispositions produce sanitized 401, 403, or 503 Responses. Direct Route
invocation requires an explicit Principal and therefore never replays or invokes
the network credential resolver, as ADR-0015 requires
(`docs/adr/0015-freeze-service-route-and-auth-composition.md:40`-`:43`). Both
paths enter the same admission evaluator and compiled handler after ingress.

## Smallest proof before EB-02

Build one disposable proof, not production Route code. It passes only if all
five groups below are executable.

### 1. Type and compiler shape

- Compile one Route with `admission: policy.public()` and one Action with
  `admission: policy.authenticated()` through application-specialized factories.
- Prove exact contextual types and emitted declarations.
- Break each forbidden candidate: `policy:` as the property name, a
  `PolicyDefinition`, `policy.exists`, `policy.rows`, a missing admission, and an
  unknown expression. Each must fail at the intended authored member, not from a
  missing factory or an unrelated Context error.
- Compare the selected `admission` property with retaining `policy`. Record
  declaration bytes, TypeScript instantiations, completion members, and the
  diagnostic quality of both; syntax preference alone is not evidence.

### 2. One normalized artifact

- Normalize Query, Mutation, Route, and Action admission to the same closed
  internal value and digest it into their executable contract.
- Assert Route and Action carry Origin and admission metadata without accepting
  a Collection target or Policy Resource identity.
- Tamper with the admission bytes and require Runtime Build verification to
  refuse the binding. A matching field name in an artifact is not sufficient.

### 3. Fail-before-work runtime control

Use an anonymous Principal whose Context resolves successfully. Drive direct
and Fetch/client Query and Mutation plus proof-only Route and Action adapters.
For `authenticated`, assert zero SQL reservations, zero Service creation, zero
handler calls, and `UNAUTHENTICATED`. Include a `public` positive control that
reaches the expected work. Nested and Live Query recomputation controls remain
the existing DX-01 obligation; the proof must show they call the same evaluator,
not merely repeat its name.

### 4. Credential outcome matrix

Drive zero resolver, anonymous, resolved, and provider-failure outcomes. The
zero-resolver case must produce a branded anonymous Principal and reach public
admission. Provider failure must produce `CREDENTIALS_UNAVAILABLE`, observe zero
Context resolutions and handlers, and never reach the anonymous branch. Direct
Route invocation must bypass resolver execution and use its explicit Principal.

### 5. Wire compatibility

- Preserve accepted wire v2 bytes and digest as a positive control.
- Emit the sibling contract containing the three selected failures and prove
  exact direct/generated-client code, retryability, sanitized detail, and
  401/403/503 mapping.
- Attempt to run an admission-bearing Operation through a retained client pair
  whose exact contract lacks the possible result. Require `CLIENT_OUTDATED`
  before credential resolution, Context Resolution, SQL, Service creation, or
  handler execution.
- Corrupt the checker so it omits one new result and prove the negative fixture
  fails. A zero-difference digest sweep without that control is not evidence.

The proof is enough to start EB-02 when it receives the repository's focused
acceptance review. It need not implement Route matching, raw-body lifetime,
overlap diagnostics, Better Auth, Action external effects, output inference, or
Action Effect Identity. Those remain EB-02 and EB-03 respectively
(`docs/v4/implementation/beta2-execution-breadth/README.md:87`-`:144`).

## Ownership after the proof

| Concern                               | Owner                                                         |
| ------------------------------------- | ------------------------------------------------------------- |
| credentials and provider availability | application credential resolver plus its external Service     |
| caller identity                       | branded Principal produced at ingress                         |
| application scope                     | Context Resolution after successful ingress                   |
| Operation admission                   | compiled admission metadata plus shared Runtime evaluator     |
| row/input/output authorization        | Collection-bound Policy Resource                              |
| Route request/response lifetime       | Route and the Fetch kernel                                    |
| Action external outcome and ambiguity | Action; later durable caller supplies stable Effect Identity  |
| wire compatibility                    | compiler-owned exact contract, digest, and retained-pair gate |
| observable safe failure               | Execution Envelope plus sanitized direct/wire disposition     |

Credential resolution precedes Context Resolution and admission. Admission
precedes SQL, Service creation, and handler execution. Collection Policy remains
inside the Query snapshot or Mutation transaction. Action performs no automatic
retry, and Route admission creates no transaction.

## What would overturn the judgment calls

- Retain the authored `policy` property only if the focused comparison shows it
  produces materially better exact types or diagnostics without implying that a
  Collection-bound `PolicyDefinition` is legal there. Existing examples alone
  are not sufficient.
- Replace `policy.*` admission values only if one authorization case accepted
  for Route or Action cannot be represented by the restricted Policy expression
  grammar. A desire for shorter syntax is insufficient.
- Collapse 401 and 403 to nondisclosing `NOT_FOUND` only if a concrete threat
  model shows that distinguishing them discloses an Operation identity not
  already fixed by the exact client/application contract, or if accepted Policy
  nondisclosure explicitly requires that collapse.
- Reuse `RUNTIME_UNAVAILABLE` for credential-provider failure only if direct and
  network callers retain a typed way to identify the credential owner without
  exposing provider detail.
- Avoid the sibling wire contract only if an executable retained-wire proof
  preserves direct/network semantic parity and a typed admission outcome using
  accepted bytes. Mapping to `INTERNAL` or executing an old client before
  discovering it cannot decode the result does not qualify.
- Add a core Auth product only if two materially different providers cannot
  compose through Service, credential resolver, Principal, Context, and Route
  without duplicating migration or authorization authority. ADR-0015's current
  boundary otherwise stands.

Until the proof passes, DX-01 remains incomplete and EB-02 must not add its own
admission vocabulary or preserve the current zero-resolver `NOT_FOUND` behavior.
