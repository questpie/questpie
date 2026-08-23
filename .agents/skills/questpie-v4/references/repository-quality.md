# Repository quality, CI, and release

## Quality lanes

- `check:changed`: changed-scope format/lint, one explicitly named red test,
  and the smallest named workspace typecheck. Target seconds.
- `quality:full`: cached repository correctness—format, zero-warning production
  lint with proof overrides, types, ordinary tests, Knip report, deterministic
  goldens, build, and docs. PostgreSQL is a parallel required CI correctness
  job, not an environment-dependent branch here.
- `quality:release`: full quality plus publication contents, supply-chain,
  declaration/API, package artifacts, and stable-runner budgets.
- `quality:typescript-forward`: non-blocking native TypeScript conformance
  beside the single canonical compiler.
- `bench:micro`: deterministic in-process kernels. Only quick stable cases may
  run on selected PRs.
- `test:load`: multi-instance HA, fanout, durable-worker, rolling-deployment,
  and optional-infrastructure loss scenarios, nightly or manual.
- `test:soak`: long-running crash/chaos and leak/retention scenarios, manual or
  scheduled outside ordinary PRs.

Correctness, microbenchmarks, load, and soak/chaos are separate evidence. The
repository owns their harness and result schema; each implementation slice owns
its scenario budget. GitHub-hosted timing reports small changes and blocks only
clear repeated regressions. Strict release budgets require tagged stable
runners.

The runnable tracer selects the smallest lane that can falsify its current
change. Product slices use these deterministic lanes and normal review; they do
not gain a formal acceptance-review lane. Kernel and exceptional release
semantic acceptance follows the proof branch only when ADR-0027 requires it.
CI verifies accepted v2 review records without model credentials; no ordinary
Product lane invokes a model.

## Classification and ownership

Use explicit workspace exports and real package/config/CLI entrypoints. Classify
compiler-generated output, convention-discovered Definitions, virtual modules,
proof fixtures, and test helpers narrowly. Start new Knip issue classes as
report-only; promote only a measured zero-noise class to blocking. Use strict
production mode for shipped packages.

Keep commands in `package.json`, behavior in config/CI, contributor workflow in
`CONTRIBUTING.md`, security reporting in `SECURITY.md`, product truth in
SPEC/ADRs/workbenches, historical proof evidence in its committed artifacts,
and the current execution flow in `docs/v4/DELIVERY-FLOW.md`. Do not maintain
living proof-head or canonical-digest ledgers in prose. Git commits and tags own
historical content identity. Runtime semantic/integrity digests and generated
acceptance-manifest hashes remain tool-derived contract evidence. Update this
branch reference only for stable cross-task procedure.

## Acceptance packet secret scan

The stateless acceptance wrapper permits only credential-free
`postgres://localhost/` or `postgresql://localhost/` test literals, optionally
with a simple database path or numeric port, and the exact source assignment
`url.password = process.env.PGPASSWORD`. These describe local configuration;
they do not place a credential value in the packet. Embedded URL credentials,
remote hosts, query strings, fragments, fallback values, alternate environment
variables, and all other credential patterns remain prohibited. Retained diffs
may contain the equivalent computed-property PGPASSWORD spelling, but authored
source uses the readable direct property. Synthetic rejection probes are
masked only on explicitly marked lines in the exact scanner test path; the
marker has no effect elsewhere. Every allowlist change requires positive
fixtures and negative controls for real URL credentials and real assignments.
