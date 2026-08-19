# BETA-09 owner decisions

Three decisions were put to the owner because autonomous work could not settle
them: whether ADR-0010 grows so Policy reaches non-Collection facts, whether
maintenance Authority is evaluated or trusted by construction, and how Studio
assets are packaged. All three are now answered, and the answers turn out to
share one consequence that no record in this set had noticed.

Base: `feat/v4` at `c8e18d02`. Implementation branch `feat/v4-beta-09` at
`2cf23a4f`.

## D1 — Studio is split, and ADR-0010 does not change

**Answered: keep the split.** Application data reaches Studio the way it
reaches any client, through generated Operations under Collection Policy.
Operational Facts reach it through an operator surface that carries its own
Authority. ADR-0010 is not amended.

Grounded, because the split is not a preference — it is what the accepted
documents already say:

- `docs/adr/0010-freeze-trusted-context-and-relational-policy.md:41` —
  `definePolicy(collection, body)` "binds one closed typed Policy program to one
  Collection". Policy is Collection-bound by contract.
- `CONTEXT.md:405` — Policy "applies to normal clients, direct operations,
  workers, recomputation, and Studio". Studio is already inside Policy's scope
  **for Collection data**. Nothing needs adding for that half.
- The durable kernel has no Collection. So the operational half was never
  Policy's to govern, and amending ADR-0010 to reach it would widen a
  Collection-bound primitive to cover rows that are not Collection rows.

The owner also asked that a managed offering — hosting plus Studio, serving
several projects, paired with the code — stay possible, while being explicitly
out of scope now: "lets just make it possible to make the app as this brings too
much complexity". That is consistent with ADR-0021, which places "remote Studio"
outside beta.1 (`docs/adr/0021-slice-the-beta-one-release.md:32`) while keeping
minimal Studio inside it (`:23`). Out of scope is not the same as foreclosed,
and the next section is about the difference.

## The consequence all three answers share

**The operator surface does not exist on the wire, and nothing in this record
set says so.**

The operational reads and commands are in-process methods on the compiled
application object — `packages/compiler/src/runtime/application.ts:464`–`:483`
freezes `worklist`, `inspect`, `events`, `effects`, `audit`, `cancelRun`,
`retryRun` and `acknowledgeAmbiguity` onto `app.durable`. The request router in
`packages/runtime/src/application/index.ts:433`–`:447` serves realtime, then the
Studio shell, then the Studio artifacts, then the Operation wire, then 404.
There is no durable route in it; `grep durable` over that file returns nothing.

The Studio client agrees. `feat/v4-beta-09:apps/studio/src/app.tsx:28`–`:33` fetches exactly one
endpoint, `/_questpie/studio/artifacts`, and the mount's own comment states the
property plainly: that path involves "no Operation, no durable read, and no
application data" (`feat/v4-beta-09:packages/runtime/src/application/studio-mount.ts:11`).

So what this slice has built is a **contract browser**. It renders the compiled
manifest, operations, migrations and origin map from static served bytes. It
cannot display one Durable Run, one attempt, one effect or one worklist row,
and it cannot invoke a maintenance command — because no transport carries them
to a browser. ADR-0003 calls Studio the "operational control surface"; the
operational half currently has no transport.

The test file shows the seam exactly. Nondisclosure is asserted against
`prepared.app.durable.*`, in-process
(`feat/v4-beta-09:tests/integration/postgres/beta09-inspection-nondisclosure.test.ts:100`,
`:107`, `:152`, `:156`), while the Studio-serving claims use `prepared.fetch`
(`:170`, `:194`). The two halves never meet in a single test, which is why the
gap survived thirty-seven commits: every individual claim is true.

This was not known when `hostile-cases.md` and `studio-purpose.md` were written.
Their in-process observations are about the Execution Envelope's telemetry sink,
a different subject.

## D2 — maintenance Authority is evaluated, and D1 decides it

**Answered: evaluated, distinct from read Authority.** This needed no separate
owner decision once D1 was answered; it follows from the glossary.

`CONTEXT.md:400`–`:403` defines Authority as "the immutable class of actions an
Execution may request", and then: "System Authority is an explicit trusted
capability and **cannot be derived from request input**."

Trusted-by-construction is only coherent while every caller is host process
code, which is true today and is exactly what makes the current state look
acceptable. The moment the operator surface is wire-reachable — which both D1's
operator surface and the owner's managed offering require — the caller is a
browser, its Authority arrives as request input, and the glossary forbids
deriving System Authority from it. So the command must be an evaluated decision
against a resolved Principal and Context, refusing with a typed, audited code.

The branch built the mechanism — `AUTHORITY_DENIED` in the rejection union with
`DurableMaintenanceAuthority` in
`packages/runtime/src/durable/postgres-maintenance.ts` — but **it is not
reachable on any shipped path**, and an earlier revision of this record
overstated it as working code this decision merely ratifies.

The guard is conditional on an optional hook
(`packages/runtime/src/durable/postgres-maintenance.ts:209`–`:210`: the denial
fires only when `input.authorize !== undefined`), and the sole production
construction site passes no authorizer
(`packages/compiler/src/runtime/application.ts:411`). Every site that supplies
one is a test constructing its own instance. So a maintenance command reached
through `app.durable.cancelRun` today applies without an Authority decision, and
records an actor the system never verified.

The branch knows this and says so rather than hiding it —
`feat/v4-beta-09:tests/integration/postgres/beta09-authority-guard.test.ts:60`–`:63` records
that the guard "is unreachable through `app.durable` … until an exposing
Operation exists", and drives the factory contract directly instead.

That deferral is the same blocker as the section above, which sharpens what is
actually at stake in the transport decision: it does not only gate Studio's
operational half, it gates the Authority enforcement D2 just mandated. An
evaluated decision needs a caller whose Authority arrives as request input.
While the only caller is host process code supplying its own `actor`, there is
nothing for the guard to evaluate that the caller did not assert about itself.

## D3 — the divergences are batched into one interstitial gate

**Answered: batch them.** The eight divergences between accepted documentation
and the tree that this slice surfaced are settled in one interstitial gate
before BETA-12, rather than one repair per slice as each is encountered.

The reason batching is safe here: no downstream slice depends on the outcome.
BETA-10, BETA-11 and BETA-12 reference Studio nowhere in
`docs/v4/prototypes/implementation-collapse-p16/QUEUE.json`. The reason batching
is _better_ is that seven of the eight share the root cause D1 names — Policy is
Collection-bound and the durable kernel has no Collection — so repairing them
together states that once instead of seven times in seven different voices.

## D4 — the glossary is repaired now

**Answered: yes, both, glossary-only.** Done in this commit, in `CONTEXT.md`:

- **`### Studio` no longer claims to read the Execution Envelope.** The claim
  was false twice over. The Envelope has no store — `durability: "telemetry"`
  with an optional sink (`packages/runtime/src/application/events.ts:23`, `:41`)
  — so there is nothing to read; and its event families are `runtime` and
  `operation` only (`:25`–`:32`), so even a stored Envelope would carry no
  durable fact. It now reads the App Contract and Operational Facts, and reaches
  application data only as any client does, through Operations under Policy.
  That sentence is D1 written into the vocabulary.
- **`### Operational Fact` is defined**, placed immediately ahead of the
  Execution Envelope entry. Every decision in this slice turns on the
  distinction between it and application data, and the glossary had no word for
  it. The entry carries
  the subtlety that the BETA-09 defect was made of: an operational record may
  carry application data as its payload, and carrying it never makes that
  payload an Operational Fact. That is why the inspection projection discloses
  presence, length and digest while withholding the bytes.

## What this does and does not unblock

Unblocked: the decision not to amend ADR-0010 (D1), which ratifies the shape the
branch already has.

Decided but **not** unblocked: the maintenance Authority evaluation (D2). The
decision is settled; wiring it needs a caller that is not host process code,
which is the transport question.

Still blocked, and now for a better-stated reason than "Studio asset packaging":
the operator surface has no transport. Packaging is a question about where
Studio's bytes come from, and it cannot be usefully answered before the question
of what Studio can talk to. A same-origin bundle, an installable package and a
host-supplied asset root are indistinguishable to a client that has nothing to
fetch.

## Judgment calls, and what would overturn them

- **That the transport gap is a real gap rather than a deliberate scope
  boundary.** It reads as an omission: ADR-0003 calls Studio an operational
  control surface, the slice built the projections and the shell, and no record
  states the halves are unconnected. Overturned by an accepted document that
  scopes minimal Studio to contract browsing only — none found.
- **That transport must be settled before packaging.** Overturned if the
  operator surface turns out to be reachable some way this review missed; the
  claim rests on one router having no durable route and one client fetching one
  endpoint, both cited above and both narrow enough to check in a minute.
- **That batching the divergences is safe.** Rests on the QUEUE.json reading
  that no later slice references Studio. Overturned by any BETA-10 or BETA-11
  work that turns out to depend on a repaired document.
