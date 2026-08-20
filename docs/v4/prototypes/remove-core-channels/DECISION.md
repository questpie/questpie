# Remove Channels from the QUESTPIE core

- Status: candidate; no authority projection before acceptance
- Date: 2026-08-20
- Scope: the framework-owned Channel Resource, not the collaboration domain's
  ordinary `channels` Collection

## Product job

Applications sometimes need transient connected-client signals: typing state,
cursor motion, presence, short-lived progress, or an advisory notification.
Those signals do not need recovery as application history. QUESTPIE already has
separate owners for the jobs that do need recovery:

- Live Query keeps an authorized Query result current from durable PostgreSQL
  change capture;
- Collection plus Query owns durable application history;
- Reaction and Job own durable post-commit or explicitly accepted work; and
- Service, Route, and Action compose an external provider without granting it
  compiler, Policy, transaction, or durable authority.

The accepted Channel contract does not match the transient job. ADR-0017 gives
Channel a PostgreSQL event identity, stable idempotency, total per-Channel
order, bounded replay, gap/reset, authority generation, and a carrier-neutral
wire. The permanent ownership map simultaneously calls Channel non-durable
fan-out whose durable truth remains in Operations. Implementing both statements
would create a second durable realtime system beside Live Query and the durable
execution kernel.

## Decision

QUESTPIE v4 removes Channels from the core product instead of redesigning them.

- There is no Channel Resource, `defineChannel`, generated Channel client,
  Channel event codec projection, Channel PostgreSQL ledger, Channel replay or
  resume contract, Channel authority generation, Channel presence model, or
  `runtime.channelCarrier` binding.
- The built-in realtime protocol carries watched Query results. It does not
  become a generic application event transport.
- Transient connected-client signals are application-owned integrations. An
  application may use Pusher, a Pusher-protocol server, Ably, a direct
  WebSocket service, or another provider through ordinary application and
  Package code. QUESTPIE publishes no provider registry or semantic adapter
  contract.
- Provider subscription authentication, connection lifetime, presence,
  transient delivery, rate limits, and provider observability remain provider
  and application concerns. They cannot authorize a QUESTPIE Operation or
  become durable application truth.
- When a provider publish must be attempted after a database commit, a Mutation
  accepts a Reaction and the Reaction crosses an external Action or Service
  boundary. The durable guarantee covers acceptance and attempts, not provider
  delivery. Physical attempts remain at least once, and a provider without
  idempotency or reliable receipt lookup retains an ambiguous outcome.
- Truly transient client-originated signals may go directly through the
  provider. They are outside the safe generated QUESTPIE contract and must not
  carry business authority or state that a reconnect must recover.
- Presence that affects authorization or business behavior is ordinary
  persisted application data evaluated through current Policy. Provider
  presence is advisory connection state only.
- A reusable provider integration may be an ordinary reference Package. It
  earns no compiler ABI, generated Channel surface, framework runtime binding,
  or claim that two implementations of one provider protocol justify a core
  abstraction.

The collaboration fixture's Company -> Space -> Channel -> Membership ->
Message graph remains unchanged. Its `Channel` is an application Collection and
domain noun, not the removed framework capability.

## Ownership after removal

| Concern                                     | Owner                                                   |
| ------------------------------------------- | ------------------------------------------------------- |
| durable authorized client state             | Query, Live Query, Change Ledger, PostgreSQL            |
| durable business event/history              | ordinary Collection and Query                           |
| post-commit acceptance, retry, cancellation | Reaction or Job                                         |
| external publish attempt                    | Action or external-effect Service                       |
| transient event identity and channel name   | application/provider integration                        |
| subscribe handshake and connection lifetime | application/provider integration                        |
| ephemeral presence                          | provider; advisory only                                 |
| business authorization                      | QUESTPIE Policy over ordinary application facts         |
| generated Channel types                     | absent; application libraries may share their own types |
| provider delivery telemetry                 | provider plus ordinary application observability        |

## Supersession

The accepted historical proofs remain immutable evidence of what was reviewed.
This decision supersedes only their forward product projection:

- ADR-0017 clauses that make Channel a compiler/Policy/PostgreSQL Resource and
  reserve a Pusher-compatible carrier;
- ADR-0019 clauses that publish `defineChannel`, Channel payloads, and
  `runtime.channelCarrier`;
- ADR-0021's promise to preserve a future Channel-compatible seam;
- the P14 Channel conformance cell as a requirement for future implementation;
  and
- every current SPEC, glossary, implementation-gate, product-matrix, and
  wayfinder statement that presents Channels as current or deferred QUESTPIE
  scope.

Historical review records, v3 evidence, and proof artifacts keep their original
text and heads. Current authority must mark their Channel conclusions as
superseded rather than rewriting the evidence that produced them.

## Rejected alternatives

- Keep the ratified durable Channel ledger but call it ephemeral.
- Retain `defineChannel` or `runtime.channelCarrier` as an unused compatibility
  seam.
- Replace Channel with a new core `Signal`, `Presence`, `Broadcast`, or generic
  event-bus Resource.
- Publish a Pusher/Soketi/provider matrix or let a provider decide QUESTPIE
  Policy.
- Route durable application state through a fire-and-forget provider event.

## Projection gate

[`PROJECTION.json`](./PROJECTION.json) pins the exact removal and preservation
obligations. [`check.ts`](./check.ts) validates them, and
[`negative-control.ts`](./negative-control.ts) proves that the checker rejects
the old durable Channel contract, a placeholder seam, provider authority,
exactly-once overclaim, and accidental deletion of the domain `Channel` noun.
Only a fresh stateless acceptance `PASS` may project this decision into ADRs and
current authority.
