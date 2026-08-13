# Contributing to QUESTPIE v4

QUESTPIE v4 is built as small tracer bullets against accepted public behavior.
Install the Bun version in `packageManager` with `bun install`, then read
`AGENTS.md`; its repository skill routes product, proof, implementation,
documentation, and quality work to the right authority.

## First contribution

Choose an unblocked issue whose authority, artifacts, fixture, non-goals,
hostile cases, budgets, and verification commands are complete. Keep the branch
and pull request to that slice. Generated files are compiler-owned: edit their
source or generator and prove a deterministic regeneration instead of hand
editing output.

Use a red test and the focused loop while iterating:

```sh
bun run check:changed -- --test path/to/test.ts --typecheck <workspace>
```

Run `bun run quality:full` before review. Run `bun run quality:release` for
exports, declarations, packaging, dependencies, release, or public artifact
changes; that lane validates stable Knip findings, performance manifests,
package exports, declarations, and built artifacts. CI, `package.json`, and tool configuration are executable command
authority; inspect `bun run` for the current list.

Place ordinary deterministic tests beside their owning package. Put PostgreSQL
integration tests under `tests/integration/postgres`, microbenchmarks in the
micro lane, multi-instance/fanout/worker/deployment scenarios in the load lane,
and crash/leak/retention matrices in soak. Every performance scenario names the
implementation slice that owns its budget.

Public behavior changes update the accepted ADR/workbench and
`apps/docs/content/docs/v4/` projection. Report vulnerabilities through
`SECURITY.md`, not a public issue. Pull requests explain the accepted guarantee,
show the red/green evidence, list commands actually run, and call out every
deferred edge. Releases use the repository release workflow; never publish a
package directly from a developer checkout.

If a command is slow, first confirm that it belongs to the selected lane. The
changed loop targets seconds; PostgreSQL concurrency, managed providers, load,
and soak run outside each red-green step.
