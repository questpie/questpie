# Static Job cron semantics

- Date: 2026-09-06
- Scope: EB-05 research input, not product authority
- Question: what is the smallest deterministic cron boundary for static Job
  schedules while dynamic domain scheduling remains an application-owned minute
  sweep?

## Repository authority already settled

This research does not reopen the Job model.

- A cron schedule is a compiler-owned projection of a Job, not a `Cron`,
  `Schedule`, `Queue`, or `Workflow` Resource.
- PostgreSQL owns schedule and tick durability. Any compatible Runtime instance
  may scan and accept ticks; there is no scheduler leader or sticky placement.
- Each scheduled instant has one stable tick identity. Concurrent acceptance is
  decided by PostgreSQL uniqueness and fencing.
- Removing a schedule prevents future acceptance and does not cancel an already
  accepted run.
- Job execution retains the existing run, attempt, lease, retry, cancellation,
  result, retention, executable-compatibility, and event kernel.
- A business-controlled next-run time is data, not static application shape.
  Applications that need per-record schedules continue to run one static
  minute Job which queries due rows under their own model and Policy.

The choices below concern only parsing calendar intent, resolving it to exact
instants, and reconciling missed instants.

## What “five-field cron” actually guarantees

POSIX orders the fields as minute, hour, day of month, month, and day of week.
Its numeric ranges are `0-59`, `0-23`, `1-31`, `1-12`, and `0-6` with Sunday
equal to zero. Each field admits `*`, a number, an inclusive range, or a
comma-separated list of those elements. POSIX does **not** specify `/` steps,
month/day names, `7` as Sunday, nicknames such as `@daily`, seconds, `L`, `W`,
`#`, `?`, or hashed/random fields. Those are implementation extensions.
[POSIX `crontab`](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/crontab.html)

The two day fields are the sharp edge. Under POSIX, when both are restricted,
a date matches if **either** the month-plus-day-of-month condition or the
day-of-week condition matches. Thus `0 0 1,15 * 1` means the first and fifteenth
of each month **plus** every Monday, not only Mondays which are the first or
fifteenth. Cronie/Vixie cron documents the same OR behavior.
[POSIX `crontab`](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/crontab.html),
[Cronie `crontab(5)` source](https://github.com/cronie-crond/cronie/blob/master/man/crontab.5)

Cronie adds the familiar `/` step form, names, Sunday `7`, and `@...` aliases.
It also makes clear that a step is scoped to its field: `*/23` in the hour field
matches hours 0 and 23 each day; it is not an elapsed 23-hour interval. A
QUESTPIE compiler diagnostic must preserve that distinction.
[Cronie `crontab(5)` source](https://github.com/cronie-crond/cronie/blob/master/man/crontab.5)

### Conservative grammar choices

| Choice                           | Boundary                                                                         | Benefit                                                     | Cost / risk                                                         |
| -------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| A — strict POSIX numeric         | Exactly the five POSIX fields and operators                                      | Smallest standard grammar                                   | Omits the expected `*/n` spelling                                   |
| B — strict five-field plus steps | Choice A plus `/positive-integer`; no names, aliases, seconds, or special tokens | Keeps the common `*/5` DX without importing a broad dialect | A documented Cronie-compatible extension                            |
| C — full library dialect         | Names, aliases, seconds and library-specific specials                            | Familiar to users of that library                           | Silently makes a third-party extension set part of the App Contract |

**Research recommendation:** Choice B. It remains recognizable cron rather than
a new expression language, but its accepted grammar can be completely listed
and compiler-validated. Canonical output should be numeric, five-field, and
whitespace-normalized. Reject a zero/negative step, out-of-range value,
descending or wrapping range, extra field, alias, or unsupported special at
compile time rather than accepting library defaults.

### Day-field choices

| Choice                 | Meaning when both day fields are restricted      | Assessment                                                       |
| ---------------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| POSIX OR               | Either field may match                           | Standard and compatible, but routinely surprising                |
| Compile-time rejection | Require at least one of the two fields to be `*` | Smallest unambiguous beginner contract                           |
| AND                    | Both must match                                  | Intuitive to some authors but incompatible with traditional cron |

**Research recommendation:** compile-time rejection. It preserves ordinary
cron where only one day dimension is used and prevents a compact expression
from hiding a product decision. An author can express the rare union as two
static schedule entries on the same Job; their static slot identities keep
ticks distinct. If the product instead chooses POSIX compatibility, the OR rule
must be in the generated description and tests. AND should not be selected.

## Time zones and DST

IANA zone names describe political rule histories, not fixed offsets. The tzdb
is updated when governments change boundaries or daylight-saving rules,
sometimes with little notice. `Europe/Bratislava` and `America/New_York` are
stable identifiers, but the mapping from a future wall time to UTC is data that
can change between tzdb releases.
[IANA time-zone overview](https://data.iana.org/time-zones/tz-link.html),
[IANA theory](https://data.iana.org/time-zones/theory.html)

A local wall time can therefore map to:

- zero instants in a forward clock change (a gap);
- one instant normally; or
- two instants in a backward clock change (a fold).

Cronie skips nonexistent local times and runs matching repeated times twice.
Temporal exposes the ambiguity explicitly through `earlier`, `later`,
`compatible`, and `reject`; choosing a library default would therefore be a
product decision, not a neutral implementation detail.
[Cronie `crontab(5)` source](https://github.com/cronie-crond/cronie/blob/master/man/crontab.5),
[TC39 Temporal time-zone documentation](https://tc39.es/proposal-temporal/docs/timezone.html),
[TC39 Temporal specification](https://tc39.es/proposal-temporal/)

Bun defaults ordinary processes to the host-configured zone and its tests to
UTC. Setting `TZ` changes process-wide `Date` behavior. That is useful for
tests, but it is not a safe multi-tenant schedule evaluator and does not bind
the tzdb version used by every host.
[Bun time-zone guide](https://bun.sh/guides/runtime/timezone),
[Bun test date/time behavior](https://bun.sh/docs/test/dates-times)

PostgreSQL already uses IANA time-zone data and recognizes full zone names. It
stores zone-aware instants internally in UTC and applies the named zone's rules
for a particular date. A PostgreSQL installation may use its bundled tzdb or be
built against system tzdata, so two separate database installations can still
carry different rule versions. One QUESTPIE application cluster, however,
already has one PostgreSQL durable authority.
[PostgreSQL 17 date/time types](https://www.postgresql.org/docs/17/datatype-datetime.html),
[PostgreSQL build-time tzdata option](https://www.postgresql.org/docs/current/install-make.html#CONFIGURE-OPTIONS)

### Resolution choices

| Choice                | Owner of wall-time → instant mapping                                                             | Determinism                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| UTC-only v1           | No mapping; all schedules are UTC                                                                | Strongest and smallest, but poor civil-time DX                               |
| PostgreSQL-owned IANA | The application's PostgreSQL cluster maps bounded UTC-minute candidates to local calendar fields | Same result for all Runtime hosts and consistent with durable authority      |
| Runtime-host IANA     | Each Bun/ICU host or imported library maps the zone                                              | Unsafe unless tzdb data/version becomes a pinned Runtime compatibility input |

**Research recommendation:** PostgreSQL-owned IANA with an explicit default of
`Etc/UTC`. Accept full IANA names only; reject abbreviations and POSIX-style TZ
strings. Readiness should verify the compiled zone against
`pg_timezone_names`. Runtime hosts then generate no authoritative local-time
answer: they ask the one database cluster that also owns tick acceptance.

Evaluate a bounded sequence of whole UTC minutes after the durable frontier,
project each instant into the named zone, and match the canonical cron fields.
This gives one precise rule without a separate DST API:

- a gap yields no matching UTC instant and is skipped;
- a fold yields two matching UTC instants and therefore two independently
  identified ticks.

That is the Cronie behavior and follows directly from “every exact instant
whose local fields match.” If product UX wants once-per-wall-label behavior,
the only conservative alternative is “first instant in a fold”; it needs an
explicit accepted rule and a test because it no longer follows ordinary cron.
Shifting a nonexistent time forward should be rejected: it changes the authored
hour and can collide with a genuinely authored later occurrence.

The stable tick identity should bind the Job identity, static schedule-slot
identity, schedule semantic digest, and scheduled UTC instant. The local label
is useful observability, but cannot be the unique identity because a fold has
two instants with the same label.

## Missed ticks and bounded reconciliation

External systems demonstrate why catch-up needs an explicit policy.
Kubernetes gives a CronJob an optional start deadline, skips an occurrence
after that deadline, and refuses to enumerate more than 100 missed schedules in
one calculation. It also warns that scheduling is approximate and Jobs should
be idempotent. These are Kubernetes policies, not universal cron semantics.
[Kubernetes CronJob documentation](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/)

Temporal likewise exposes a catch-up window as schedule policy rather than
pretending downtime has no semantic consequence.
[Temporal TypeScript schedule sample](https://github.com/temporalio/samples-typescript/blob/main/schedules/src/start-schedule.ts),
[Temporal scheduler source](https://github.com/temporalio/temporal/blob/main/service/worker/scheduler/workflow.go)

### Catch-up choices

| Choice                   | Reconciliation after downtime                                                                                        | Fit with existing QUESTPIE guarantees                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Lossless bounded batches | Enumerate every missed matching instant in fixed-size transactions until the durable frontier reaches database `now` | Preserves independently deduplicated ticks and “wake loss cannot lose a tick”; backlog can be large |
| Bounded age window       | Accept every tick newer than a fixed age; durably record older skipped ticks/frontier advancement                    | Bounds backlog, but introduces intentional expiry as new public semantics                           |
| Latest-only coalescing   | Accept only the newest missed instant                                                                                | Smallest workload, but changes multiple independent ticks into one and hides lost work              |

**Research recommendation:** lossless bounded batches. “Bounded” should describe
work per claim/transaction, not silently discard semantic occurrences. Persist
the scan frontier in PostgreSQL, lock or compare-and-set it, enumerate at most a
fixed number of UTC minutes/ticks, insert ticks with their stable unique
identity, advance only through the examined interval, commit, and repeat.
Concurrent Runtime scanners may duplicate computation but PostgreSQL admits one
tick. A crash before commit advances neither accepted ticks nor the frontier.

This policy needs explicit admission protection: expose backlog age/count,
apply a fixed batch and transaction-time budget, and let normal Job queue
backpressure control attempts. Do not execute handlers inline with catch-up.
If a later product needs expiry, add the bounded-age policy explicitly rather
than changing old schedules. Latest-only coalescing is not a compatible
implementation shortcut.

Removal and rolling deployment retain the Accepted rules. A removed static slot
cannot create future ticks, while already accepted ticks remain runnable on
compatible bytes. The exact boundary between “future” and an already-due
unreconciled instant must be ratified with the durable schedule state; it cannot
be inferred from which Runtime build happened to scan first.

## Existing TypeScript parser evidence (source review only)

No package was installed.

| Source                                                                                                                                                                                                                                            | Useful evidence                                                                                                           | Why not import its contract wholesale                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [CronosJS parser](https://github.com/jaclarke/cronosjs/blob/master/src/parser.ts), [expression](https://github.com/jaclarke/cronosjs/blob/master/src/expression.ts), and [package](https://github.com/jaclarke/cronosjs/blob/master/package.json) | TypeScript, no runtime dependencies, separates parsing from next-date evaluation, and makes DST gap/fold options explicit | Still accepts a broader dialect and owns in-process scheduling/time-zone behavior QUESTPIE should leave to its compiler/PostgreSQL owners    |
| [Croner pattern source](https://github.com/Hexagon/croner/blob/master/src/pattern.ts) and [date source](https://github.com/Hexagon/croner/blob/master/src/date.ts)                                                                                | Zero-runtime-dependency TypeScript with extensive range/step and DST tests                                                | Its seconds/year fields, `L/W/#/?/+`, aliases, one-shot dates, timer scheduler, and selectable DOM/DOW semantics are much broader than EB-05 |
| [`cron-parser` parser source](https://github.com/harrisiirak/cron-parser/blob/master/src/CronExpressionParser.ts) and [package](https://github.com/harrisiirak/cron-parser/blob/master/package.json)                                              | Mature typed iterator and strict-mode evidence that simultaneous DOM/DOW restriction is hazardous                         | Uses Luxon and exposes six-field plus extended syntax; strict mode requires six fields, so it is not the desired five-field contract         |

The smallest honest implementation direction is therefore an internal parser
for the explicitly accepted subset, producing canonical field bitsets/arrays
in the compiled Job schedule artifact. Reusing tests and edge-case ideas is
valuable; importing a parser's full accepted language or its timer scheduler is
not. Any copied source would also require its license and provenance review.

## Candidate boundary for ratification

The evidence supports this coherent KISS candidate:

1. A Job may declare one or more static schedule slots; no scheduling Resource
   or second runtime is added.
2. Each slot contains a strict numeric five-field expression plus `/` steps and
   one full IANA zone, defaulting to `Etc/UTC`.
3. The compiler rejects simultaneous restricted day-of-month/day-of-week,
   unsupported cron extensions, invalid ranges/steps, and invalid shape; it
   emits canonical field sets and a semantic digest.
4. PostgreSQL maps UTC minutes to the schedule's civil fields. Gaps produce no
   tick; folds produce two ticks. Runtime-host locale, `TZ`, `Date`, and ICU data
   are not schedule authority.
5. PostgreSQL stores the schedule frontier and unique tick acceptance. Scans
   catch up losslessly in bounded batches; failures publish no partial frontier.
6. Tick identity binds Job, static slot, schedule digest, and UTC instant.
7. Removing a slot blocks future acceptance without cancelling accepted runs;
   rolling compatibility decides which retained executable may claim them.
8. Dynamic per-domain schedules remain ordinary application data processed by
   an application-authored minute sweep Job.

## Questions that still require authority, not more parser research

- Whether “removed” suppresses an already-due but not yet accepted instant, or
  whether the old slot must reconcile through a recorded removal instant.
- The exact fixed scan batch, transaction-time, backlog, and observability
  limits. These should be derived from the PostgreSQL tracer rather than copied
  from Kubernetes' controller constants.
- Whether a tzdb rule update is ordinary future calendar correction or a
  deployment compatibility event requiring an explicit schedule recompile.
- Whether product compatibility outweighs beginner safety enough to choose
  POSIX DOM/DOW OR instead of compile-time rejection.

Those are the only material semantic choices exposed by this research. Parser
selection does not answer them.
