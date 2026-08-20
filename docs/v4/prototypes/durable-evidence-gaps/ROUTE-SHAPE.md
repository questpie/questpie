# The durable route: what shape it can take

`docs/v4/implementation/beta09/README.md` records that one route closes four
open items — it expires the Q3 in-process qualifier, unblocks `owner-decisions.md`
D3, makes the maintenance Authority hostile case fully drivable, and lets the
same-origin Studio bundle reach an Operational Fact. That makes its shape the
highest-leverage remaining design question.

This records the shape and the one constraint that decides it. It writes no code
and opens no slice.

Base: `feat/v4` at `3ef59f71`.

**Standing note: a descope has landed that changes what this record is for.**
`65643c1c` adds `docs/adr/0024-descope-minimal-studio-from-beta-one.md`
(`Status: Accepted`, superseding ADR-0004 and ADR-0021 where they require a
minimal Studio path in `4.0.0-beta.1`), deletes `apps/studio/` — `HEAD` now
carries no file under that path — and re-scopes BETA-09 as a backend-only
maintenance-compatibility slice. Everything below was written against the
pre-descope scope and is left as recorded rather than rewritten, because the
comparison it makes is what a later release reintroducing an inspection surface
will need.

**Its factual premise checks out**, verified against `feat/v4-beta-09` rather
than taken from the draft. The ADR says the browser "could not inspect Collection
rows, invoke an Operation, or observe a running application" and that finishing
it would ship "a second presentation of generated JSON already available as files
and CLI output". The branch's `apps/studio/src/app.tsx:35` fetches
`/_questpie/studio/artifacts` and renders the JSON it returns; its mount test
asserts only a same-origin `GET` returning 200 and `text/html`
(`tests/unit/beta09-studio-mount.test.ts`). Artifacts are generated files, so the
description is accurate.

**What it would do to this record.** The route shape exists to give Studio a
reachable, authorized path to operational facts. With no Studio in beta.1 the
reads lose their consumer, and the three-shape comparison becomes a question for
whichever release reintroduces an inspection surface rather than for BETA-09. The
half that survives is the maintenance path — which
`docs/v4/implementation/beta09/acceptance-shape.md` already separates from the
inspection path, and which is the half that has a Principal and needs only a
decision written where a brand check sits.

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
over `durable_runs` is exactly that.

**A later check falsified the sentence this decision rested on.** An earlier
revision said "making the reads Operations buys a resolved Principal, a Tenant
and a fresh Execution — and zero authorization." That is true of a **Mutation**
and false of a **Query**, which is what an inspection read is.
`packages/compiler/src/generate.ts:322`–`:325` emits `QueryContext` as exactly
two members, `data` and `signal`. `MutationContext` at `:327` extends
`Omit<RootExecution, "services">`, and `RootExecution` carries `principal` and
`authority` (`fixtures/collaboration/.questpie/generated/app.ts:148`–`:150`). So
a Query handler is handed no Principal, no Tenant and no Authority at all.

The precedent the decision cited does not transfer either. `execution.ts:45` and
`:62` sit inside `defineContext({ resolve: async ({ input, principal, bootstrap })`
— the **Context resolver**, which is given `principal` as a parameter. A Query
handler is a different surface and gets none of it, and the resolver's `values`
do not reach `QueryContext` either.

**So the decision below cannot be built as written, and it is retained with that
stated rather than quietly rewritten**, because the reasoning around it is still
the useful part. **Everything to the end of this section belongs to it** — its
cost, and both of its overturning conditions. Read them as the case that was
made for a mechanism that turned out to be unavailable, not as live commitments.

**Superseded decision: the inspection Authority decision is evaluated in the
handler, against the resolved facts the engine supplies, raising a declared
error.** No
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

**Where that leaves the shape, decided rather than left open.** Three ways to
give an inspection read an evaluated Authority, given a Query handler cannot see
a Principal:

1. **Shape the reads as Mutations.** `MutationContext` has the facts today and
   needs no contract change. Rejected: it opens a transaction for a read and puts
   operator reads in the mutation projection, which misrepresents them.
   **That rejection is now grounded rather than asserted.** ADR-0011:27 does not
   merely permit a transaction, it requires one — "Mutation … owns exactly one
   PostgreSQL transaction" — so shaping a read as a Mutation opens a transaction
   by contract, not by accident.
2. **Widen `QueryContext` to carry the resolved Execution facts.** This is the
   smallest change that makes the superseded decision buildable, and it is the
   same ADR-level widening already named above as the overturning condition for
   the declarative option.

   **Its code cost was traced rather than guessed, and it is smaller than
   "ADR-level" suggests.** Nothing needs threading: the facts are already bound
   one frame above the narrowing.
   `packages/runtime/src/execution/index.ts:280`–`:291` freezes `facts` with
   `principal`, `authority`, `tenant`, `values`, `signal` and `deadline`, then
   calls `program.project({ facts, service })` at `:290`. That `project` is
   emitted by `packages/compiler/src/runtime/application.ts:344` as
   `({ facts }) => Object.freeze({ data: … })` — it **receives the whole facts
   object and deliberately keeps only `data`**. The contrast is in the same
   file: `projectMutation` at `:369` passes `facts` through whole, which is why
   `MutationContext` has what `QueryContext` lacks.

   So widening is two coordinated edits — the emitted projection at
   `application.ts:344` and the `QueryContext` interface at
   `generate.ts:322`–`:325` — over a value already in scope. The expense is the
   accepted-contract change, not the plumbing.

   **That condition has since been met, by searching properly rather than by
   guessing at rationale wording.** An earlier revision of this paragraph said no
   recorded reason for the narrowing was found. There is one, and it is Accepted
   authority. ADR-0011 (`Status: Accepted`) states at
   `docs/adr/0011-freeze-query-mutation-and-explicit-lifecycle.md:23`–`:26`:
   "Query receives a generated read-only `ctx.data` and owns one bounded
   consistent read snapshot. It cannot write, dispatch, access a database or raw
   SQL handle, open a transaction, bypass Policy, obtain System Authority, or
   call an external Action through its Context." ADR-0019:68 reinforces it as a
   principle rather than an accident — the factories "share implementation
   kernels while preserving exact per-kind contexts."

   So the narrowing is deliberate and specified, and the emitted projection at
   `application.ts:344` implements the ADR rather than under-serving it. **That
   raises option 2's cost and lowers its likelihood**: it is not a contract
   widening in the abstract, it contradicts a named sentence in an Accepted ADR
   that positively specifies what a Query receives. The code cost traced above
   stands and is now the least interesting part of the decision.

   Note what the ADR does _not_ say, checked by reading the whole passage rather
   than the clause that suited the argument. It forbids obtaining **System**
   Authority through the Context, not carrying an ordinary resolved Principal.
   And its "cannot … access a database or raw SQL handle" is not a bar on
   framework-performed SQL: the Mutation sentence carries the same prohibition
   five lines later — "no raw transaction handle" (`:32`) — while a Mutation
   plainly does perform SQL. Both clauses forbid the **handler** holding a
   handle, not the engine reading on its behalf. An inspection read exposed as a
   generated, bounded accessor is not excluded on that ground, and I nearly
   recorded that it was.

   **What the passage does constrain is singular, and that simplifies the
   amendment.** `:23` specifies what a Query receives — "a generated read-only
   `ctx.data`" — so the resolved Principal **and** a durable read accessor both
   sit outside it. That is not two amendment questions but one: whether a
   Query's context may carry anything beyond `ctx.data`. ADR-0019:68 makes the
   answer load-bearing rather than incidental, since per-kind contexts are
   preserved by design.

3. **The durable route**, the alternative this record weighed. **This is the
   only one of the three that needs no accepted-authority amendment, and that
   was checked rather than assumed.** ADR-0015:33–:35 specifies that a Route's
   "handler receives the exact `Request`, typed parameters, **Principal**,
   cancellation, deadline, and only Route-safe Services. It receives no data
   facade, Mutation facade, raw database, or ambient System Authority." The
   Principal is in the Route contract already, so an inspection Authority
   decision can be evaluated in a Route handler today, by contract, with no ADR
   changed.

   The data half still works: a Route "enters ordinary application behavior only
   through an explicit generated Execution transition" (`:36`–`:38`), so the
   Authority decision happens in the Route handler, where the Principal is, and
   the reads happen after it. Nothing needs `ctx.data` to carry a Principal.

**So the three shapes differ in kind, not degree.** One and two need an Accepted
ADR amended — option 1 to stop a Mutation owning a transaction it is required to
own, option 2 to let a Query's context carry more than `ctx.data`. Option 3
needs no amendment and instead needs work that accepted authority already
specifies and nobody has built: route mounting, Fetch dispatch, and the `routes`
projection, which ADR-0014 assigns to ADR-0015's slice.

**Recommendation, and it is a judgment call.** Prefer option 3. Building
specified-but-unbuilt work is a smaller commitment than amending a frozen
contract, and this record already establishes that the command half needs that
same work regardless — so option 3 serves both halves while options 1 and 2
serve only the reads. What would overturn it: the route work proving materially
larger than an ADR-0011 amendment, or an owner deciding the per-kind context
boundary should move for reasons beyond this slice.

**The recommendation has a cost the comparison above hides, and it is against
me.** Option 3 needs no ADR amended, but it needs work **no slice owns**.
Checked in `QUEUE.json`: the open slices are BETA-09 through BETA-12 and none
carries a route artifact, while BETA-03 and BETA-05 name "raw Route" in their
`nonGoals` — deferred, not assigned. ADR-0014:32 places the `routes`
direct-invocation projection with ADR-0015, and no queued slice implements
ADR-0015's route half.

So the real choice is sharper than "amend a contract versus build specified
work". It is: **amend an Accepted ADR inside a slice that exists**, or **build
unowned work that first needs a slice to own it**. Option 3 is still the better
shape on authority, and it is the more expensive one on process — a beta.1 queue
that accepts one bounded tracer at a time has no obvious room for it, and
BETA-09 cannot absorb it without becoming the route slice.

That tension is the decision an owner has to make, and it is not mine to settle.
What this record can say is that neither path is cheap and the cheap-looking one
was cheap only because nobody had priced the ownership.

**A second cost, and this record raised it before I recommended the route
without answering it.** The decisive-question section above argues ADR-0014
points away from a route: entry paths "use the same Context, Policy, Operation,
transaction, error, result, and observation engine"
(`docs/adr/0014-freeze-runtime-client-envelope-and-minimal-studio.md:38`), and
then this record's own reading of it at `:52` — that a second route with its own
auth handling is a second engine by another name. That second clause is
inference, not ADR text. It previously stood in quotation marks immediately
after the ADR citation and joined to it by "and", where a reader would take it
for a second quotation from the ADR; the phrase appears nowhere in `docs/adr/`.
Recommending option 3 without addressing that left the record arguing with
itself.

**It reconciles, but only partly, and the remainder is a real cost.** ADR-0015
requires a Route to enter ordinary application behaviour "only through an
explicit generated Execution transition", which then "uses the accepted Context,
Policy, Query, Mutation, transaction, observation, and error kernels" (`:36`–`:39`).
So the _data_ half creates no second engine — the route is a doorway into the
accepted one. What does sit outside it is the Authority decision itself, which
happens in the Route handler before the transition, and that is precisely the
"own auth handling" ADR-0014's sentence warns about.

**So option 3's cost is three things, not two:** the unbuilt mounting and
dispatch, the absence of an owning slice, and an auth decision evaluated outside
the Operation engine that ADR-0014 wants entry paths to share. The third is the
one this record was right about first and I overlooked. It does not reverse the
recommendation — options 1 and 2 amend an Accepted ADR outright, which is worse
than sitting in tension with one — but a comparison that omitted it was flattering
the option I preferred.

**The finding moves weight from 1 to 2 and 3.** BETA-09's criterion 1 requires
inspection Authority to be _evaluated_, and no path available today lets a Query
evaluate one. What would overturn this reading: a `QueryContext` that carries
`principal` on some path I did not find — the check was
`grep -n "interface QueryContext" -A 4 packages/compiler/src/generate.ts`, and
the same read shows `MutationContext` inheriting `RootExecution`, so the
instrument does see a thick context when there is one.

**What would overturn the whole shape:** a demonstration that an Operation
cannot carry a handler-evaluated authorization acceptably — for instance if the
hostile case cannot distinguish a denial from a miss without a declarative
contract. At that point the separate route becomes the cheaper option, and
ADR-0014's one-engine rule would need an argued exception rather than being
quietly broken.

## The exposure flag is binary, and that splits the decision

Testing this record's own claim that "the existing wire refusal already applies"
turned up a constraint it missed.

**`network: true` puts an Operation in the generated browser client.** The
exposure mapping is binary — `exposure: value.network === true ? "network" :
"server"` (`packages/compiler/src/model.ts:264`) — and the client is built from
exactly the resources whose `contract.exposure === "network"`
(`packages/compiler/src/runtime/client.ts:55`, `:59`). There is no third state:
an Operation is server-only and unreachable over Fetch, or it is on the wire
**and** in every application's generated client.

BETA-08's accepted criterion 13 says "the generated browser client gains no
durable control plane"
(`docs/v4/implementation/beta08/acceptance-manifest.json:120`), and its round-3
review noted that criterion "disclaims only a _browser_ durable control plane".

So the Operations shape splits:

- **Inspection reads** as `network: true` Queries are arguably permitted — reads
  are not a control plane — but they would still add durable inspection methods
  to every generated client, which no application asked for.
- **The maintenance commands are not permitted this way.** `cancelRun`,
  `retryRun`, and `acknowledgeAmbiguity` are unambiguously a control plane.
  Exposing them as `network: true` Mutations puts them in every browser client
  and violates criterion 13 directly.

**Correction to the shape above.** "Expose the inspection reads as generated
Operations" survives with a caveat about unrequested client surface. "Route the
whole durable surface through the Operation engine" does not — the commands
cannot go that way while the exposure flag is binary.

**The narrowed options.** Either the commands arrive through a Route, which
ADR-0015 calls "the bounded raw Fetch escape hatch"
(`docs/adr/0015-freeze-service-route-and-auth-composition.md:30`) and which SPEC mounts into
`app.fetch`; or the Operation contract gains a third exposure state meaning
on-the-wire-but-not-in-the-client, which is new authoring surface and an ADR
decision. The second is tidier and larger; the first uses an accepted mechanism
and costs the one-engine property for the command half.

This reopens only how the **commands** arrive, which the earlier revision folded
into the same answer without checking that it could.

An earlier version of this sentence added that it "does not reopen the reads
decision or the handler-evaluated authorization below it". The exposure split
still does not reopen either — but the handler-evaluated authorization was
separately superseded above, so that reassurance now points at something that no
longer stands. The reads decision is open for a different reason than this
section.

## Both narrowed options are unbuilt, and the Route one more than it looks

The previous section offered the commands "a Route, which ADR-0015 accepts as an
explicit HTTP escape hatch." Checking whether a Route can carry anything today
changes that framing.

**`defineRoute` exists as a name that cannot be called.** The factory is
generated (`packages/compiler/src/discovery.ts:403`, listed at
`packages/compiler/src/generate.ts:213` and `:450`), and it lands in the
application's generated surface typed as
`EmptyDefinitionFactory = (definition: never) => never`
(`fixtures/collaboration/.questpie/generated/app.ts:184`, applied at `:199`).
Nothing is assignable to `never`, so authoring a Route is a **compile error at
the call site, not a silent no-op** — an earlier phrasing here, "a name and
nothing behind it", invited the opposite reading. The runtime end is empty as
well:

- `packages/runtime/src/application/index.ts` contains **no reference to
  `route`** — the Fetch path dispatches nothing to one;
- the runtime application exposes no `routes` member, and ADR-0014 says why:
  "ADR-0015 **later** adds the compiler-owned `routes` direct-invocation
  projection" (`docs/adr/0014-freeze-runtime-client-envelope-and-minimal-studio.md:32`);
- nothing in the compiler's runtime lowering or model matches a `"route"` kind.

So a Route is declared authoring surface with no mounting, no dispatch and no
projection. It is the same shape as `authority.isSystem()` recorded in
`docs/v4/prototypes/authority-contract-gap/FINDING.md`: an authored name the
runtime cannot yet satisfy.

**Corrected framing.** The choice for the commands is not "an accepted mechanism
versus an ADR decision." It is **two pieces of unbuilt work**:

| Option               | What it needs                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Route                | route mounting, Fetch dispatch, and the `routes` projection — which ADR-0014 assigns to ADR-0015's slice, not this one |
| third exposure state | a new value in the exposure mapping and a client generator that excludes it — new authoring surface, an ADR decision   |

Neither is cheap, and neither belongs to BETA-09 as scoped. That is worth
knowing before someone plans the command half around a Route on the strength of
the name existing.

**What this does not change, corrected.** An earlier version of this paragraph
concluded that "the reads still work as `network: true` Queries today, with
handler-evaluated authorization … the read half is buildable now". The first
half of that is right and the conclusion is not. Queries are wired and Routes
are not, so the reads do **reach the wire** today. But handler-evaluated
authorization is unavailable — the mechanism is dismantled in "Where the
authorization decision lives" above — so the reads reach the wire
**unauthorized**.

That was corrected in the decision section of this record and left standing
here, which is the failure this record set keeps producing: a correction applied
where it was noticed rather than everywhere the claim was relied on. This is the
paragraph a planner reads.

**The honest split.** Not "reads buildable, commands blocked". It is:

| Half     | Reaches the wire | Can evaluate an Authority              | Also needs                       |
| -------- | ---------------- | -------------------------------------- | -------------------------------- |
| reads    | yes, as Queries  | **no** — needs one of the three shapes | —                                |
| commands | no               | **no** — same problem                  | mounting, dispatch, a projection |

So the authorization gap is common to both halves, and for commands it is the
smaller of their two problems rather than a reason to treat the reads as ready. BETA-09's criterion 1
depends on closing it for the reads alone.
