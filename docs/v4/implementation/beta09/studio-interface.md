# BETA-09: the Studio interface increment

The same-origin mount and the artifact path are built and driven; the shell they
serve is an empty skeleton. This fixes the shape of the increment that fills it,
so that work starts from a plan rather than from discovery.

Not started here deliberately. It is a build-system change — a bundler, React,
and a dependency set — and that is the kind of setup whose mistakes are quiet
and expensive to find. It deserves a fresh start, not the tail of a long
session.

Base: `feat/v4-beta-09` at the artifact-path increment.

## What exists to build on

Owner direction, recorded 2026-08-18: build on the shadcn and Base UI primitives
already in the QUESTPIE design system.

- The design system is `apps/docs`: shadcn at style `base-mira`, phosphor icons
  (`apps/docs/components.json`), on `@base-ui/react`, Tailwind, and Vite.
- Fourteen primitives exist under `apps/docs/src/components/ui/`: `alert-dialog`,
  `badge`, `button`, `card`, `combobox`, `dropdown-menu`, `field`, `input-group`,
  `input`, `label`, `select`, `separator`, `tabs`, `textarea`.
- `apps/studio` has no build beyond `tsc`, and neither React nor a bundler is
  hoisted to the workspace root; `vite` resolves only inside `apps/docs`.

## What the increment must do

1. **Give `apps/studio` a client-only build.** Studio is served by `app.fetch`
   as static assets, not by a second server, so this is a Vite client build
   emitting a bundle — not TanStack Start, which `apps/docs` uses because it is
   an SSR documentation site.
2. **Serve the built output from the mount.** `studio-mount.ts` currently
   returns an inline shell string. It must serve the build's `index.html` and
   its assets instead, which turns the mount from a constant into a file
   reader and needs a resolved asset root.
3. **Render the catalog from the artifact path.** The page fetches
   `/_questpie/studio/artifacts` and runs the independent producer already
   built in `apps/studio/src/projection.ts`. That keeps one producer rather
   than a second in-browser projection.

## Step 2 is deliberately not taken

Serving the build output turned out to hide a fork that has nothing to do with
file reading. The mechanism is the same in all three shapes — the mount reads
assets from a root instead of returning a constant — so none of it is wasted by
the delay. What differs is **where the assets live for a deployed application**,
and that decides whether every application carries Studio.

At runtime the generated app reads its artifacts from
`new URL("../", import.meta.url)`, the `.questpie/generated/` directory
(`packages/compiler/src/runtime/application.ts:209`). So the three candidate
roots are:

1. **Studio assets become build artifacts**, written into the generated output
   and flowing through the existing inventory and digest machinery. The mount
   then serves them from `artifactFiles`, exactly as it already serves the
   contract artifacts, and startup verification covers them for free. The cost
   is that **every** application build carries roughly 230 KB of interface,
   including applications that never open Studio.
2. **Studio stays a package the application may depend on**, resolved at build
   time the way `@questpie/runtime/bundle-core` already is
   (`packages/compiler/src/artifacts.ts:468`). Only an application that wants
   Studio installs it. The cost is that `apps/studio` is `private: true` and
   unpublished, so this needs a real publication decision, and the resolve must
   fail softly when it is absent.
3. **The mount takes an asset root supplied by the host.** Smallest change,
   decides nothing, and puts an operational path in the deployer's hands rather
   than the framework's — which is where the accepted contract has generally
   refused to put things.

**Owner decision, 2026-08-20: stop the interface increment.** Option (1) can be
built, but completing it would package a second presentation of generated JSON
that developers can already inspect directly. Options (2) and (3) only move
that low-value surface elsewhere. None produces the intended administration
product.

The discarded implementation attempt made the cost concrete: it added a Vite
asset pipeline, UI dependencies, fonts and theme output while leaving the
browser unable to inspect a Collection row, invoke an Operation, or observe a
running application. Those changes were removed rather than normalized into a
permanent release burden.

The backend inspection projection, nondisclosure rules, worklist, provenance,
Authority types, audit reason and protocol work remain useful inputs to future
observability. The empty shell and static artifact catalog are not treated as a
product milestone. No protocol-v2 `PASS` may claim criteria 21 or 22.

What would reopen Studio: Accepted authority for one useful end-to-end admin
workflow — Collection rows, executable Queries/Mutations/Actions, or stored
logs/traces — including the privileged Principal and its Policy/Authority and
disclosure rules. At that point the asset packaging choice can be made against
a real deployed surface.

## Constraints this increment inherits

- **The runtime bundle must not grow with the interface.** The realtime bundle
  budget was re-derived once already, and its record states that the headroom is
  not for Studio's UI. Assets belong in `apps/studio` build output, served by
  the mount, never inlined into every application's runtime bundle.
- **A first view can be built from the primitives that exist.** Cards, badges,
  tabs, and separators carry a catalog. What is missing for a dense evidence
  surface — `table`, `dialog`, `popover`, `tooltip`, `sonner`, `scroll-area`,
  `command`, `breadcrumb`, `pagination` — should arrive as additions to the
  shared design system through the shadcn registry, not as Studio-local
  components, or the design system forks on first use.
- **Decision-first, not facts-first.** `studio-purpose.md` decided the
  destination is the decision a fact enables. A catalog that lists identities
  and stops is the facts Overview that record rejected.
- **Nothing operational reaches the browser.** The artifact path serves compiled
  contract behind a named allow-list. Runs, events, effects, and the audit are
  server-internal and stay that way; the interface explains the application, and
  what it may show of a run is bounded by `inspection-contract.md` rather than
  by what the page asks for.

## What this does not resolve

The fourth required artifact, Policy-protected inspection Operations, stays
blocked by an ADR-0010 clause rather than by missing work, and an interface does
not change that. A Studio page can explain the compiled contract without it; it
cannot show operational facts to a browser until Policy can reach something that
is not a Collection.
