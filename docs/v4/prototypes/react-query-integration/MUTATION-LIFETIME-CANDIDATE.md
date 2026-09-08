# Retire the UI owner, not the committed write

Proposed construction decision. ADR-0023 keeps Mutation outcome and recovery
identity authoritative. Native TanStack Query owns Mutation execution and hook
state. The adapter does not add a write kernel, retry loop or replacement hook.

The pending-response diagnostic shows that cache removal alone leaves
the observer, callback and original Promise able to expose a later result.
The next test seam is the generated Mutation invoked through a native
`MutationObserver`, with only its external HTTP peer held or failed.

The candidate has two responsibilities:

- On scope disposal, reset currently attached native Mutation observers and
  remove that scope's Mutation cache entries. Other scopes stay untouched.
  Old options fail before dispatch. Application code already holding a copied
  result or an unattached native handle does not become erasable memory.
- Bind one existing Call Identity to each generated invocation. If the scope
  retires before the adapter hands the decoded outcome to native Mutation
  execution, discard the domain result and return
  an adapter-local `SCOPE_RETIRED` disposition. It distinguishes not dispatched,
  known committed, declared rejection and unknown outcome. Preserve a real
  transaction identity only when the existing generated decoder supplies one.
  No result, declared-error payload, exception cause or transport detail enters
  that disposition. Do not reuse `COMMITTED_RESULT_UNAVAILABLE` for local
  disposal, invent a transaction ID, or assert rollback on response loss.

The generated decoder records safe outcome metadata in a private WeakMap at
its validated error-construction sites. Classification must match the Operation
and the current invocation's Call Identity. Publicly constructing an error or
matching its structural type proves neither commit nor server rejection. The optional
adapter must not duplicate the wire decoder or trust an arbitrary exception's
message as proof of commit. While the scope is active, exact generated results
and declared errors retain their current types and behavior.
Declared rejection describes this submitted command; it does not prove that
the Call Identity never committed another command. In particular,
`IDEMPOTENCY_CONFLICT` can refer to a previously committed different input.

This boundary cannot cancel arbitrary JavaScript. Once an active invocation
hands its result to native TanStack execution, already-started global or
application callbacks may keep their copies and continue across disposal.
Native callback errors do not prove that a database write rolled back. A
Promise whose native callback pipeline already received the result is outside
the pre-disclosure fence; pretending otherwise would require replacing native
execution. This limitation must be explicit in the eventual public contract.

Disposal performs no replay and does not cancel a dispatched transaction by
claim. The original generated transport still owns its deadline and response.
Any deliberate receipt recovery must keep the same scoped Call Identity and
canonical command under an appropriate current execution; the new UI scope
must not automatically inherit the old input, result or optimistic work.

Required falsifiers: completed observer cleanup; success and response loss
after retirement; existing post-commit failure identities; declared-error
nondisclosure; no dispatch through retired options; independent concurrent
calls; and a callback already running when disposal occurs. This experiment
does not yet implement optimism, post-commit observation or invalidation.
