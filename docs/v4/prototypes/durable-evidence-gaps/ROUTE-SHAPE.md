# The durable route: what shape it can take

`docs/v4/implementation/beta09/README.md` records that one route closes four
open items — it expires the Q3 in-process qualifier, unblocks `owner-decisions.md`
D3, makes the maintenance Authority hostile case fully drivable, and lets the
same-origin Studio bundle reach an Operational Fact. That makes its shape the
highest-leverage remaining design question.

This records the shape and the one constraint that decides it. It writes no code
and opens no slice.

Base: `feat/v4` at `3ef59f71`.

## The decisive question, and it has a clean answer

Two shapes are available: expose the inspection reads as **generated
Operations** on the wire that already exists, or add a **separate durable
route** with its own plumbing.

ADR-0014 points hard at the first: "Direct, Fetch, generated-client, nested,
recompute, worker, and Studio entry paths use the same Context, Policy,
Operation, transaction, error, result, and observation engine." A second route
with its own auth handling is a second engine by another name.

The objection is that `inspection-contract.md` establishes operational facts are
**not Collection rows**, so Collection Policy does not reach them — and if a
Query were Collection-bound, inspection reads could not be Operations at all.

**They are not Collection-bound.** `defineQuery`
(`packages/compiler/src/generate.ts:394`) takes a definition and freezes it with
`kind: "query"` and `identity: \`query:\${name}\``. Nothing binds a Collection.
The fixture's own Query proves it in use
(`fixtures/collaboration/src/consumer.ts:7`): `name`, `network: true`, an input
codec, an output codec, and a handler. A Query is a named server computation
with exact codecs, not a Collection projection.

So the objection dissolves. Inspection reads can be ordinary Operations.

## What that buys, and it is most of the open list

Routing them through the Operation engine means Authority arrives the accepted
way rather than a new way. ADR-0014: "Fetch credentials resolve outside the
request body and construct one fresh ordinary root Execution." That is precisely
what the Q3 qualifier says is missing — with no wire route, the only caller is
in-process and mints its own `Principal`, so the evaluation judges a
self-asserted claim.

An Operation-shaped inspection read gets a Principal resolved outside the
request body, a fresh root Execution, and a Context. The evaluation then has
something adversarial to refuse, and the hostile case can prove what it exists
to prove rather than half of it.

It also keeps the disclosure story where the mount already put it. The Studio
mount argues that "what Studio may see is decided by what it can call, not by
how its bytes arrive"
(`feat/v4-beta-09:packages/runtime/src/application/studio-mount.ts:11`). If what
it calls is an Operation, the existing wire refusal already applies — the Fetch
path rejects any operation outside the network wire, which BETA-08 built and
`inspection-contract.md` criterion 14 pins.

## Where the authorization decision lives

An earlier revision left this open. It is decidable, and the shape of the hole
is sharper than "nothing obviously supplies it".

**A Query declares no authorization of its own.** `QueryFactory`
(`packages/compiler/src/generate.ts:377`–`:384`) takes exactly `name`,
`network?`, `input`, `output`, and `handler`. Every `admit:` in the fixture is on
a `definePolicy` bound to a Collection
(`fixtures/collaboration/src/message-policy.ts:42`, `:46`, `:118`, `:140`,
`:159`). So a Query's authorization is entirely inherited from the Collection
Policies of the data it touches.

**A Query that touches no Collection therefore has none.** An inspection read
over `durable_runs` is exactly that. Making the reads Operations buys a resolved
Principal, a Tenant and a fresh Execution — and zero authorization.

**Decision: the inspection Authority decision is evaluated in the handler,
against the resolved facts the engine supplies, raising a declared error.** No
contract widening, and it has a precedent in the accepted surface rather than
being invented: the Context resolver already makes authorization decisions in
code against resolved facts, throwing `context.error.unauthenticated()` at
`fixtures/collaboration/src/execution.ts:45` and `context.error.notFound("tenant")`
at `:62`.

**The cost, stated rather than buried.** A handler-evaluated decision is not
declarative, so it does not appear in a projection the way Policy does. Nothing
compiles it, nothing digests it, and a reviewer cannot read the authorization
off an artifact — it has to be read off code and driven by a test. That is a
genuine loss against how the application lane works, and it is the price of
authorizing something that is not a Collection.

**What would overturn it:** widening the Operation contract to declare
non-Collection admission, which would restore the declarative property and make
the authorization projectable. That is new authoring surface and belongs to an
ADR, not to this slice — but if it is coming, doing it before the route lands
avoids authorizing the same reads twice.

**What would overturn the whole shape:** a demonstration that an Operation
cannot carry a handler-evaluated authorization acceptably — for instance if the
hostile case cannot distinguish a denial from a miss without a declarative
contract. At that point the separate route becomes the cheaper option, and
ADR-0014's one-engine rule would need an argued exception rather than being
quietly broken.
