# Compiler verification under Bun's test host

This note records why the native consumer's complete compilation check needs
an ordinary Bun process instead of the `bun test` process that discovers it.
The failure changed which installed dependency was bundled, not just chunk
names.

## The captured failure

Team Support Desk declares `pg` 8.23.0; the Runtime declares 8.22.0. In a
captured failure on Bun 1.3.14 (`0d9b296a`), resolving `pg` from the original
fixture's `runtime` directory returned the Runtime's 8.22.0 package. The same
call from the relocated fixture returned 8.23.0. The original auth bundle
therefore reused the Runtime's `Pool` instead of retaining its own driver.
The pg 8.23 pipeline implementation was absent from every original emitted
JavaScript file and present in the relocated auth bundle.

A complete trace recorded 480 `Bun.resolveSync` calls without skipping any.
The first wrong result came from `application-source.ts` inside the first
application bundle, after two structural evaluation builds. Replaying the
preceding resolver calls alone did not reproduce the failure. Neither did
small package fixtures created after the test process started.

## Reproduce the host difference

Set `TMPDIR` to an existing directory you own; choose disk-backed storage if
the system temporary directory has a quota. Then run the explicit diagnostic:

```sh
bun tests/support/compiler-test-host-repro.ts
```

The script creates and removes only its own child directory. It installs nothing and
does not read credentials or connect to a database.

The script creates the entire source tree before either child starts. A root
`node_modules/dupe` exports `root-v1`; a nearer `top/node_modules/dupe` exports
`app-v2`. The entry imports a nested module that imports `dupe`. Both hosts run
the same `body.ts`, with two sequential `Bun.build` calls and identical
configuration. The test child deliberately runs bare `bun test`, without a
filename argument, so discovery visits the pre-existing directories.

Observed on the pinned Bun executable:

| Host           | Both emitted bundles        | Resolver result     | Child exit |
| -------------- | --------------------------- | ------------------- | ---------- |
| `bun test`     | `root-v1`, missing `app-v2` | Ancestor package v1 | 1          |
| `bun plain.ts` | `app-v2`, missing `root-v1` | Nearer package v2   | 0          |

The script prints both child results, including their exact output and exit
codes. A failed ordinary-process control fails the diagnostic. It does not
assert that the test child must fail: a Bun version that fixes the defect may
pass both hosts. This is a diagnostic, not a release gate.
Its generated failing test exists only in the owned temporary tree and is
never automatically discovered as part of this repository's suite.

## Mechanism and verification boundary

[Bun PR 36245](https://github.com/oven-sh/bun/pull/36245), associated with
[issue 36242](https://github.com/oven-sh/bun/issues/36242), describes the test
scanner retaining directory descriptors at end-of-file. A later bundle
re-reads a cached descriptor without rewinding it and records an empty
directory. Losing a directory's `node_modules` entry can make package lookup
continue to an ancestor. The tiny reproduction demonstrates that silent
version substitution on the pinned executable. The descriptor explanation
comes from upstream source analysis; this investigation did not independently
trace the descriptor cursor.

The test-host boundary retains both real compilation calls in one ordinary
child process and returns the unmodified maps for complete path/byte comparison.
Original-source compilation, relocation, stale-output rejection, runtime
artifact integrity and native consumer types remain required checks. This
costs a child process; it does not authorize changing the production resolver,
aligning application dependency versions, normalizing bundles, or relaxing
the equality assertion. An ordinary-process failure remains a compiler defect.
