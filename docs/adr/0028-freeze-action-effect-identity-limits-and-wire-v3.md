# ADR 0028: Freeze Action Effect Identity, Limits, and Operation Wire v3

- Status: Accepted
- Date: 2026-08-24

## Context

ADR-0026 accepts Action as the boundary for one external or nondeterministic
invocation. It requires stable caller material, Runtime-scoped Effect Identity,
explicit limits and honest ambiguity, but deliberately leaves their exact
public and wire contracts to focused proof.

Direct and network calls must now share one semantic kernel without conflating
Effect Identity with Mutation Call Identity, domain input, transport limits, or
a provider idempotency promise. Operation Wire v1 and v2 must remain exact for
retained Query and Mutation clients.

## Decision

### Caller material and Runtime identity

- Every ordinary direct or network Action call supplies `effectKey` as required
  stable text metadata. Generated caller options also retain optional `callId`
  correlation and the existing optional timeout. There is no random or implicit
  `effectKey`.
- `effectKey` is already-NFC text containing 1 through 256 Unicode scalars and
  at most 1024 UTF-8 bytes. Runtime rejects NUL, lone surrogates, non-NFC text,
  omission, and aliases such as `effectId` or `idempotencyKey`; it never rewrites
  the value.
- The caller does not supply the final Effect Identity. Runtime derives a
  UUID-shaped `effect.id` under the disjoint
  `questpie.effect-identity.action.v1` domain from the canonical application and
  Action Resource Identities, trusted Tenant, validated Principal kind and id,
  and `effectKey`.
- Domain input, `callId`, attempt, timeout, transport, trace, process and wall
  clock are excluded. Repeating one admitted Action with the same trusted scope
  and key therefore reaches the handler with the same identity, even if input
  changes. Each admission may still execute; QUESTPIE adds no coalescing,
  receipt ledger or exactly-once claim.
- Handler Context's Effect metadata exposes only readonly `effect.id`.
  Framework-owned responses and failures expose neither the key nor the derived
  identity. Authored output
  and declared-error codecs remain application-owned and may deliberately
  return the identity; Runtime does not scrub valid domain data.

The derivation bytes are exact. Runtime hashes this byte sequence with SHA-256:

```text
UTF8("questpie.effect-identity.action.v1") || 0x00 ||
UTF8(canonicalJsonLine({
  action,
  application,
  effectKey,
  principalId,
  principalKind,
  tenant
}))
```

The object field names are literal and its values are the validated strings
named above. `effectKey` equality is exact UTF-8 equality after validation; no
case folding or normalization occurs. The UUID uses the first 32 lowercase hex
digest characters in `8-4-4-4-12` form, replacing the first character of the
third group with `5` and the first character of the fourth group with `a`. The
pinned collaboration vector is:

```text
application: application:collaboration
tenant:      018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0
principal:   user / 018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4
action:      action:delivery.publish
effectKey:   provider-request-2026-08-24-0001
effect.id:   6a58264b-7e1b-58db-abfa-b46e3cd5cd7f
```

### Action limits

Every Action Definition owns this required closed map:

```ts
limits: {
	inputBytes: number;
	resultBytes: number;
	durationMilliseconds: number;
}
```

- Both byte ceilings are positive safe integers. Duration is a nonnegative safe
  integer. Missing, partial, extra, fractional, negative, non-finite and unsafe
  values are invalid; there are no defaults or aliases.
- `inputBytes` measures UTF-8 bytes of the strict canonical JSON-line encoding
  of codec-encoded semantic input. `resultBytes` measures the same encoding of
  either successful output or an authored declared-error payload. Route body
  limits and Runtime request/response framing limits remain separate owners.
- Canonical JSON-line recursively sorts object keys by ascending UTF-16 code
  units, renders primitives with JavaScript `JSON.stringify`, uses UTF-8
  encoding and adds one terminal LF. It rejects
  non-finite numbers, negative zero, `undefined`, bigint, functions, symbols,
  cycles and lone surrogates; codec text also remains already-NFC. Invalid input
  is `PROTOCOL_UNSUPPORTED`; invalid handler output or declared-error payload is
  sanitized `INTERNAL`.
- The Action duration is monotonic time across Policy admission, Effect
  validation, semantic input measurement, Context and external-Service
  projection, handler execution, and semantic outcome validation. Each process
  converts the earlier of Action duration and remaining root budget into its
  local deadline; no wall-clock or foreign monotonic instant crosses a boundary.
  Deadline addition saturates at `Number.MAX_SAFE_INTEGER` and never wraps or
  hands an overflowing delay to a JavaScript timer.
- Zero duration is observed after trusted binding and Policy admission but
  before Effect validation, codec work, capability projection or handler work.
  Policy denial therefore remains nondisclosing and wins over an exhausted
  budget.
- A validated result or declared outcome wins over a racing owned deadline.
  An unrelated `AbortError` is an internal failure, not forged cancellation.

### Operation Wire v3 and ambiguity

- Operation Wire v3 is an additive, exact and closed successor of v2. Retained
  Query and Mutation contracts stay byte-compatible. The Action request uses
  the existing correlated request fields plus required top-level `effectKey`.
  Operation and failure identities remain globally canonical-sorted.
- Wire v1 or v2 never executes Action. It returns `CLIENT_OUTDATED` before
  Context, Service or handler work. Selected-operation/request-operation
  disagreement also fails before work.
- A pre-execution rejection proves zero Action work. After dispatch, fetch
  rejection, response loss or truncation, cancellation race, malformed content
  type or JSON, unknown frame, or wrong correlation becomes non-retryable
  `ACTION_OUTCOME_AMBIGUOUS`. Its framework payload contains only `callId`.
- Provider rejection and authored `outcomeUnknown` remain distinct declared
  outcomes. No Action path retries automatically.
- If a settled success or declared-error payload exceeds `resultBytes`, Runtime
  returns non-retryable post-handler `RESOURCE_LIMIT`. It does not prove provider
  nonacceptance and authorizes no replay, including when an authored
  `outcomeUnknown` payload itself is oversized.
- Framework failures contain no authored semantic payload and are not charged
  to `resultBytes`; the separate Runtime `responseBytes` limit owns their network
  framing.

### Capability boundary

Policy remains the only authorization model. Action Context has immutable
Execution facts, external-effect Services, generated Query and Mutation
callers, and readonly Effect metadata. It gains no data facade, raw database,
transaction, durable control, System elevation, Auth provider, schema,
migration, session UI, provider registry, or automatic provider retry.

## Consequences

- Direct and network adapters must enter one semantic measurement and Effect
  Identity kernel; transport adapters cannot weaken limits or ambiguity.
- Providers may use `effect.id` as stable material, but QUESTPIE never claims a
  provider honored it. Receipt lookup and convergence remain provider or
  application behavior.
- Durable Job and Reaction effects retain their accepted production identity
  derivation. Ordinary Action uses a disjoint domain while preserving the same
  UUID grammar for future Job Action checkpoints.
- Wire v1 and v2 artifacts and retained compatibility remain immutable. New
  Action client/runtime projection requires exact Wire v3 artifact and digest
  evidence.

## Rejected alternatives

- Caller-supplied final `effectId`, Mutation `callId`, domain-input identity,
  `idempotencyKey`, random/default material, or a deployment salt.
- Including canonical Action input in identity derivation.
- Process-local duplicate coalescing, a Runtime receipt ledger, exactly-once
  wording, or automatic Action retry.
- Route-shaped or aggregate byte limits, zero as unlimited, implicit defaults,
  or raw transport bytes as the semantic Action limit.
- Reusing a pre-work-looking protocol failure after dispatch or echoing
  `effectKey` in framework failures.

## Acceptance

The combined executable proof and replacement manifest were reviewed at
`eb3744d35fe56dcb78ab2378ee63b0d29639cf13`. The fresh stateless replacement
review returned `PASS`; its credential-free verified record is committed at
`c2e2fd08006ffc3dc1e074eef18ba1ea413492ef` in
[`action-wire-v3-effect-identity/REVIEW-REPLACEMENT.json`](../v4/prototypes/action-wire-v3-effect-identity/REVIEW-REPLACEMENT.json).
