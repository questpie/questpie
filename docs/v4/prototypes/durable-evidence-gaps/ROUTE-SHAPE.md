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

## The one thing this does not settle

**Which Authority the inspection Operations evaluate.** They are Operations, so
they get Context and a root Execution — but `maintenance-decisions.md` Q3
decides inspection Authority is _distinct_ from Collection Policy, and an
Operation's ordinary authorization is Policy. So the reads need an authorization
that is evaluated per-Operation rather than per-Collection, and nothing in the
accepted surface obviously supplies it.

That is a real gap and it is not this record's to close. It is also smaller than
it looks: the Operation engine supplies the _inputs_ an inspection Authority
needs — a resolved Principal, a Tenant, a fresh Execution — and what is missing
is only the decision function, not the plumbing to reach one.

**What would overturn the whole shape:** a demonstration that an Operation
cannot carry a non-Policy authorization without widening the Operation contract.
At that point the separate route becomes the cheaper option, and ADR-0014's
one-engine rule would need an argued exception rather than being quietly broken.
