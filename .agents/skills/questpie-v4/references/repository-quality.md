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

The stateless acceptance wrapper permits only these credential-free source
forms, not the values produced when the source runs:

- PostgreSQL localhost URL literals with an optional simple database path or
  numeric port, without a username, password, query, or fragment.
- Assignment of process-only PGPASSWORD or a freshly generated UUID to the
  password property of the local `url` variable. Direct and computed-property
  spelling are recognized; authored source uses direct property spelling.
- The exact retained PostgreSQL URL template that combines a role variable
  with PGHOST, PGPORT (default port 5432), and PGDATABASE, without a password.
  The scanner recognizes this source form wherever it occurs in packet text;
  it does not resolve the environment or claim the resulting endpoint is local.
- Documentation placeholders describing password forwarding without a value.

The owner-approved historical-removal and committed-TypeScript source-form
exceptions are specified in the
[packet-safety decision](../../../../docs/v4/implementation/acceptance-packet-safety/DECISION.md).
Historical redaction is explicit in the manifest and packet; source-form
recognition changes only the scanner's shadow, never reviewed source bytes.

The executable spellings live in `acceptance-packet-secrets.ts` and its positive
and negative fixtures. Embedded credentials, literal remote endpoints, URL
queries/fragments, alternate password environment variables, and password
fallback expressions remain prohibited. Synthetic rejection probes are masked
only on marked lines in the exact scanner test path, including retained diff
context. The marker has no effect in other files. Every allowlist change must
preserve negative controls for real URL credentials and real assignments.
