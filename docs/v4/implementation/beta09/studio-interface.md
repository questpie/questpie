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
