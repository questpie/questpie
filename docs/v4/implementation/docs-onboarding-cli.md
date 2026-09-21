# Documentation-driven onboarding CLI

Owner request: replace the public documentation with a researched, verified
learning path. On 2026-09-09 the owner additionally authorized implementing
missing CLI steps in this repository instead of documenting an incomplete
first-run workflow. No push or publication is authorized.

This is Product work projecting the existing schema and composition kernels
(ADR-0002, ADR-0006, ADR-0007). It does not change migration, receipt, Policy,
or compiler compatibility contracts.

## Concrete delivery

One locally packed application must initialize, compile the connected
Barbershop example, plan and review its initial migration, create immutable
migration and Seed artifacts, apply them to disposable PostgreSQL, start,
and execute a typed read/write. Extend the schema and demonstrate that stale,
modified, destructive-unapproved and blocked plans cannot write artifacts.

- `init --name`: explicit application root, generated import mappings, strict
  TypeScript configuration, tracked artifact directories, generated ignore.
  Preserve dependencies/scripts; refuse conflicting existing configuration.
- `migration plan --name [--rename from=to]`: compile current source, validate
  the existing history, reuse the existing planner, store canonical Plan bytes
  under its digest. With DATABASE_URL, check the live base before emitting.
- `migration create --plan [--accept-destructive digest]`: recompile and
  revalidate history/Plan; persist the compiler's exact six-file result.
- `seed create`: compile source Seeds and persist new immutable three-file
  artifacts after checking identity, dependencies, and existing checksums.
- Existing `build`, `check`, `migration apply`, `seed apply`, `start`, schedule
  and MCP commands remain the execution path. A separate sync/dev alias or a
  second migration engine is unnecessary for this first-run tracer.

Serialize local schema authoring, publish complete artifact directories, and
never replace existing history. PostgreSQL apply remains responsible for its
existing transaction, receipt, compatibility and drift rules.

## Verification

Focused tests: project initialization and preservation; immutable artifact
creation; stale plan, changed bytes, exact destructive acknowledgment,
dependency/identity checks; packed CLI and real PostgreSQL read/write/restart.
Run changed-scope formatting/lint/types, architecture check, docs typecheck and
build, then required quality:full and quality:release. Keep package generation
serialized and use task-owned disk TMPDIR. Record actual results below after
execution; prior release evidence does not certify these edits.

Research: ../research/documentation-experience-2026-09-09.md.

## Delivered documentation

Research compares official Convex, Payload, Supabase, Better Auth and ElysiaJS
pages across onboarding, motivation, concepts, examples, navigation and API
reference. The public root replaces all 23 prior pages and adds 12 dedicated
pages, retaining stable URLs for existing links. `meta.json` separates learning,
task guides, API reference and version inventory.

The connected example starts with a blank packed-package consumer, defines
tickets/comments/Policy/Query, adds a named Mutation, commits schema and Seed
artifacts, runs a trusted server script, then connects the generated client,
Better Auth, React, and Start. Auth includes exact provider migration, Service,
credential resolver, raw routes, browser entry, sign-in and cleanup code. Storage
is explicitly application-owned; no Files package or upload protocol is claimed.
CLI dev/sync aliases, package inventory management, Studio and health endpoints
are not invented. Standard package management and explicit build are the working
alternatives where applicable.

Internal ADRs, acceptance/proof records and historical drafts remain intact.
Existing durable/schedule evidence tests still compile their retained fixtures;
new public snippets are extracted by packed consumer tests rather than copied
into competing example implementations.

## Initial independent review dispositions

Three read-only Claude Opus 5 reviews covered facts, prose, and examples. Raw
outputs are retained in the task scratch directory outside the repository.
Verified findings fixed: client `timeoutMilliseconds` instead of server
`deadline`; React adapter ownership of declared-error guards; `collection.list`
uses `expr.always()`; Query/Mutation/Action required member differences; explicit
preview checkout/install; complete Auth/browser hosting; Start configuration;
script typecheck inclusion; Seed string timestamps vs decoded Date; step ordering;
reserved/expanded schema-name rejection; rename identity and destructive rules;
missing reference details for embedded values and Operation Sets; health endpoint
claim removed. Plan files publish canonical bytes atomically.

The examples review's proposed requirement to add a CRUD Operation Set before
`tickets.rename` was rejected after source verification: ADR-0030 generates
internal Collection kernels for named Mutations (`mutation/kernel.ts`,
`adr0030-compiler-provenance.test.ts`). The real packed compilation, typecheck,
and PostgreSQL Mutation prove the existing example. Operation Sets separately
expand authored CRUD Operations. The initial assertion that field rename hints
cannot pass the CLI prefix guard was also rejected: field identities begin with
`collection:`; the compiler performs full rename validation.

## Executed verification so far

- Packed CLI + PostgreSQL 17: **1 pass, 50 assertions**. Exact public snippets
  compile and typecheck; Vite builds; provider migrations apply; sign-up issues a
  real cookie; anonymous access is denied; authenticated Query and Mutation work;
  logout revokes access. Initial migration/Seed application and repeat receipt
  recovery pass. Tampered/stale/destructive-unapproved/blocked plans are refused.
- Changed-scope formatting/lint, CLI init tests (2 pass, 25 assertions), package
  types, and `git diff --check` pass.
- Earlier native React/Start packed docs tests passed; final broad runs below
  include the updated Start config extracted verbatim.
- Initial full run had 3 failures: stale local seroval dependency links, a
  timing-budget overrun during concurrent work, and a missing package dist file
  while a separate build replaced it. `bun install --frozen-lockfile --force`
  restored the exact lockfile dependency graph (no lockfile edit); the native
  Router serializer test then passed. Full checks are rerun without overlapping
  package builds. These failed runs are not described as passing evidence.

Final full/release/docs results and cleanup follow after completion.

## Outline and source coverage

| User task                   | Learning path                                                        | Independent reference / source authority                                      |
| --------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Why QUESTPIE; mental model  | `index`, `concepts`                                                  | SPEC and public package exports                                               |
| Install and initialize      | `installation`                                                       | `cli`; `packages/questpie/cli/project.ts`                                     |
| Store and read data         | `data-and-queries`                                                   | `collections-reference`, `context-and-policy`; Field/Policy/relational source |
| Write a ticket              | `queries-and-mutations`                                              | `executable-definitions`; compiler internal Mutation kernels                  |
| Change schema and seed      | `schema-lifecycle`                                                   | `cli`; existing compiler schema/Seed artifacts plus CLI projection            |
| Call from another process   | `clients`                                                            | `client-reference`; generated client transport                                |
| Establish a session         | `auth`                                                               | `services`; public credential resolver and raw Route seam                     |
| Live React / SSR            | `react-query-basic`, `react-query-start`                             | `react-query`, `realtime`, `reactive-query-resources`; packed native tests    |
| Uploads                     | `uploads`                                                            | Explicit application integration, no Files capability claimed                 |
| Custom behavior             | `custom-logic`                                                       | `executable-definitions`, `durable-reactions`, `scheduled-jobs`               |
| Custom host / external code | `escape-hatches`                                                     | `services`, `definition-composition`; generated App and public seams          |
| Integrations and deployment | `ecosystem`, `runtime-and-studio`, `multi-instance`, `opentelemetry` | Public package manifests, CLI host and adapter source                         |
| Tool/API projection         | Guides link to reference                                             | `operation-http-and-openapi`, `basic-mcp`; existing canonical projections     |

The learning sequence follows why → one new concept → complete file/command →
observable result. API entries own required members and limits, so the tutorial
does not repeat a competing symbol catalog.

## Remaining product boundaries

| Capability                                                          | Outcome                                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Fresh CLI setup and schema/Seed artifact authoring                  | Implemented here over accepted kernels; no upstream task left instead of code.                                |
| Watch-mode `dev` / inventory `sync`                                 | Not implemented; explicit build and static configuration are usable alternatives.                             |
| Better Auth Package                                                 | No shipped Package; the tested application Service/Route/resolver integration is the working alternative.     |
| Files / storage protocol                                            | No shipped capability; application integration is described as design work, not a tested built-in upload API. |
| Health probe endpoints                                              | No shipped endpoints; custom host owns startup/drain probes.                                                  |
| Studio, Search, workflow orchestration, offline/live infinite lists | Not claimed by the current public docs; no fabricated commands or APIs.                                       |

These boundaries do not become product promises or ADR acceptances merely by
being listed. A wider Files/Studio/health product change is a separate scope.

## Follow-up review and final focused checks

The second fact review reports no blocking finding. The second example review
reports no blocking compile/API error in the cumulative chain. The prose review
identified two practical gaps, both repaired: Start now owns
`vite.start.config.ts`, keeps the basic login host intact, and documents switching
frontends at the same cookie origin; tutorial CLI calls use
`bunx --no-install questpie`, which the packed PostgreSQL test executes.

Further verified repairs: explicit Auth runtime typecheck inclusion, concrete
Docker database setup, preview output directory creation, plain-client declared
error shape, an actual client Mutation helper, MCP configuration, explicit
Collection data capability composition, complete deferred Job and webhook Action
examples. Runtime compilation caught two mistakes in the new Action draft before
completion (environment reads inside discovery and application-lifetime external
Service); the final example moves environment access to `runtime/` and uses an
execution-lifetime external Service. The Services reference states this boundary.

The expanded PostgreSQL test passes **55 assertions**, including real Action
HTTP delivery with effect identity and worker execution of the deferred named
Mutation checkpoint. Updated inverse-list and Start consumers pass **2 tests,
28 assertions**. The first release attempt found that the inverse consumer
staged the new client helper without its prerequisite Mutation chapter; it was
stopped and corrected. The final release run starts after this focused repair.

Stable legacy URLs are retained deliberately to preserve incoming links; page
titles and navigation use the new outline. Repeated preview notices remain on
entry points where the existing availability contract requires them. Neither
choice is a promise of an unreleased feature.

## Release artifact binding

The final release invocation repeated full correctness successfully: 1,232
ordinary tests, 199 gated skips, zero failures; the separate fixture lane added
8 passing tests. Strict Knip and the two-package contract passed. The dry-run
then correctly rejected the old current artifact-manifest checksum because the
CLI bytes changed. This was a working release manifest, not an archived ADR or
acceptance record.

Both public packages were packed twice independently. Each pair was byte-identical;
all declaration hashes were unchanged. Only the current `questpie` archive hash
in `quality/release/package-artifacts.json` needed updating. The gated release
contract then passed all 3 tests / 18 assertions, including drift rejection.
Remaining release commands are continued in the same order as `quality.ts`
without rerunning the already-passing full suite for a one-hash manifest change.
The original `quality:release` process exited nonzero at the old checksum; its
continuation results are recorded separately, not represented as a single clean
invocation.

The final Docker recipe was exercised with a task-specific container name and
an allocated loopback port: password authentication and both `C.UTF-8` locale
members passed. TCP `pg_isready -h 127.0.0.1` avoids mistaking the image's temporary
initialization server for the finished server. Both task-owned PostgreSQL
containers have been removed; existing preview infrastructure was preserved.

## Final outcome — verified

All remaining release gates passed in sequence: relocated native Firefox
consumer (2 tests), basic tutorial Firefox (1), Start Firefox including cleanup
fault injection (1), OpenTelemetry package isolation (1 / 2,390 assertions),
OpenTelemetry CLI ownership (1 / 24 assertions), and all 19 performance manifests.
This is local correctness/reference validation, not managed-provider, load/soak,
new formal acceptance, manual visual approval, or publication evidence.

Documentation types/build and all 35 navigation/link/anchor checks pass.
Architecture passes for 430 production TypeScript files. The CLI's explicit
TypeScript check passes. No dependency manifest or lockfile changed. Only the
current core package archive hash changed in the release artifact inventory;
OTel and every declaration hash remain unchanged.

No push, tag, publish, deployment, commit, or external tracker update was made.
Historical ADRs and acceptance/proof artifacts are preserved. Task-owned
PostgreSQL resources are removed. Research, initial/follow-up review output,
failed-run logs and successful command logs remain in
`/home/drepkovsky/code/questpie-docs-rewrite-scratch` for inspection; disposable
consumer directories are cleaned after the checks.

## Sidebar and release copy follow-up

The owner requested native Fumadocs navigation and public copy written for the
beta.2 release. This supersedes the earlier public preview notices, but does not
change internal publication status or authorize publishing. Installation now
uses exact npm version specifiers. Registry installation was not exercised;
the package contents were verified through the packed-consumer evidence above.

Navigation follows https://www.fumadocs.dev/docs/headless/page-conventions and
the installed Fumadocs 16.14.0 implementation: a root folder, four collapsible
folders, relative page references, and concise page titles. Existing URLs and
MDX source paths are preserved. No custom sidebar renderer was added.

Checks: docs types and production build passed; navigation tests passed (2 tests,
190 assertions), along with changed-scope formatting/lint and git diff --check.
Headless Firefox screenshots confirmed the compact introduction sidebar and
automatically expanded tutorial with its active page highlighted. Collaborative
browser navigation was unavailable; screenshots were taken with local Firefox.
The development server remains bound to 0.0.0.0:43130.

Reactions remain supported alongside Jobs: compiler generation and accepted
SPEC retain both definitions. No durable API was removed by this documentation
change.
