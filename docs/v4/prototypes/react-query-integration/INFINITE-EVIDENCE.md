# Generated forward infinite Query checkpoint

Proposed prototype evidence, 2026-09-08. No public export, architecture PASS or
beta.2 release gate is claimed.

Full Support Desk compilation now feeds its identity-bound forward-page
metadata into the existing generated client. The sibling exposes native
`infiniteOptions` only for proven structural root pages. The generated input
omits the actual cursor parameter and retains the authored page-size parameter;
there is no repeated DTO, codec or caller-owned cursor mapping.

The first runtime test failed because `infiniteOptions` did not exist. The
implementation now passes four tests with 21 assertions: three-page traversal,
a nonempty terminal page, Date decoding, native `maxPages` eviction/refetch,
ordinary/infinite identity separation, captured mutable input and retirement.
The capture test initially expected repeated URL strings for a list; the actual
accepted transport uses `~json:`. Correcting that test expectation changed no
transport behavior and is not an implementation red/green claim.

The strict native consumers cover `useInfiniteQuery`,
`useSuspenseInfiniteQuery`, selected views and exact cursor-array cache types.
Native 5.102.8 initially inferred `pageParams: unknown[]`; an identity `select`
preserves the projected cursor type without replacing native cache data.
Generated options remain usable with application selectors.

Commands from this prototype:

- `bun run test:infinite`: four passes / 21 assertions after full compilation.
- `bun run types:infinite`, `types:renamed`: PASS.
- `bun run test:pagination-source`: one pass / five assertions.
- `bun run test`, `test:generated`, `test:live`, `test:react`: 27 passes /
  102 assertions across the existing native/generated suites.
- `bun run types:generated`, `types:react-errors`, `types:generation`: PASS.

Use a writable process-local `TMPDIR` for full compilation on this machine;
the unrelated system temporary quota remains untouched. Root scripts
`format` and `lint --deny-warnings` pass for the changed sources, and
`git diff --check` passes. Independent read-only Standards/Spec review found
no new actionable findings in this slice.

The combined main baseline is 32 tests / 128 assertions. The independently
constructed `bun run test:pagination-renamed`, also rerun by the main agent,
adds one pass / eight assertions through a copied
Support Desk fixture: `continuation` replaces `after`, the generated transport
uses the renamed parameter, and a handler reusing the existing page codec does
not gain an inferred paging capability. The first fixture run lacked its local
dependency link; fixing that test setup changed no compiler behavior. The
combined executed total is 33 tests / 136 assertions.

These are synthetic HTTP responses, not PostgreSQL or browser infinite
execution. Existing render-time registry ownership, SSR identity and pending
Mutation retirement remain open. Infinite lists are one-shot native pages, not
independent per-page watches or atomic cross-page snapshots.
