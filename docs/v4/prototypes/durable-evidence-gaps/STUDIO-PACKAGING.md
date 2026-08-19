# The packaging fork: accepted authority narrows it further than it looks

`feat/v4-beta-09:docs/v4/implementation/beta09/studio-interface.md` records a
fork it deliberately does not take — **where Studio's built assets live for a
deployed application, and whether every application carries them**. This records
what accepted authority already decides about that, so whoever takes it starts
from the constraints rather than from the options.

A finding, not a decision. It writes no code and opens no slice.

Base: `feat/v4` at `6e64c9e5`.

## Studio is optional, and that is contract rather than preference

ADR-0003:19 — "**The optional** official interface is Studio."
`CONTEXT.md:27` — "The **optional** inspector and operational control surface
for one compiled QUESTPIE application."

Both accepted, and both use the word deliberately. So a packaging shape in which
**every** deployed application necessarily carries Studio's bytes contradicts an
Accepted ADR and the glossary together. That does not decide the fork, but it
removes one of its arms: "always bundled, no opt-out" is not available.

## The bundle is checksum-verified and immutable, which shapes the rest

ADR-0014:22 — "`questpie build` publishes one checksum-verified immutable
Runtime bundle. The bundle binds the exact Application Identity, Manifest, App
Contract…" and readiness fails for "a corrupt, stale, cross-application,
schema-incompatible, or executable-incompatible bundle" (`:71`).

Two consequences for the fork:

- **Assets served from the bundle are inside the verified boundary.** If
  Studio's built output ships in the Runtime bundle, its bytes are covered by
  the same checksum discipline as everything else, and a tampered asset is a
  startup failure rather than a served file. That is a real safety property and
  an argument for bundling.
- **Assets served from outside it are not.** A resolved asset root read from
  disk at request time — which is what `studio-interface.md` step 2 describes,
  turning the mount "from a constant into a file reader" — sits outside the
  verified boundary unless something extends verification to it.

So the fork is not only about size. It is about whether Studio's bytes inherit
the bundle's integrity guarantee, and that is a question the record should ask
explicitly rather than settle by whichever mechanism is easier to write.

## What this does not settle

Whether optionality is satisfied by a build-time flag, a separate artifact, or a
runtime toggle. All three are compatible with "optional", and accepted authority
does not choose between them — ADR-0014's list of what applications do not
author (`:67`) rules out an authored entrypoint but says nothing about a build
flag.

**What would overturn the narrowing:** an argument that "optional" describes the
_surface being reachable_ rather than the _bytes being present_ — that shipping
the assets while refusing to serve them satisfies it. That reading is available
and it is weaker, because the cost the word most plausibly protects against is
every application carrying an inspector it did not ask for.
