# Public package identities prototype

- Status: executable prototype, not product authority
- Run: `bun test docs/v4/prototypes/public-package-identities/package-identities.test.ts`

This prototype answers only the public package-identity question. It models two
published packages:

```text
questpie
├── questpie
└── questpie/react

questpie-opentelemetry
└── questpie-opentelemetry
```

`questpie` owns the framework root and the optional `./react` projection. Its
React peer is `^19.2.0` and is marked optional, so importing the root neither
installs nor loads React. Importing `questpie/react` has one ordinary ESM import
of `react` and therefore fails when React is absent. There is no runtime probe,
silent disable, alternate implementation, or fallback.

The toy core also retains `./internal/observability` so the naming experiment
does not imply deletion of the existing private adapter bridge. The proof checks
for the required root and React exports; it does not close the rest of core's
real export inventory.

`questpie-opentelemetry` remains a separate package because it owns the
OpenTelemetry dependency graph. It exact-peers `questpie` at
`4.0.0-beta.2`; the core package neither depends on it nor imports it in this
prototype.

The executable test first stages a React-free, OpenTelemetry-free consumer and
proves that `questpie` imports successfully. It then proves that
`questpie/react` fails without React and works after React 19 is installed, that
the telemetry package fails without core and binds through it when present, and
that `@questpie/react` and `@questpie/opentelemetry` do not resolve. The two
manifests expose no alias for either old name.

A second case packs both prototype packages twice and compares their SHA-256
digests, installs the archives offline into relocated core-only and complete
consumers, and repeats the root, React, and telemetry imports from packed bytes.
It also executes the declared peer ranges against compatible and incompatible
React and QUESTPIE versions. These are isolated candidate-package facts, not a
claim that production packages or beta.2 release artifacts have migrated.

This directory deliberately does not modify or supersede current Accepted
ADRs, `SPEC.md`, `CONTEXT.md`, production packages, generated artifacts, or
public documentation. A ratified package-identity decision must precede any
production migration.

`authority-projection.json` is the closed post-PASS projection and breaking
deletion inventory. `staging-check.ts` proves the candidate remains Proposed,
the current accepted and production surfaces still carry the pre-decision
package graph, and no review record exists before formal review.
