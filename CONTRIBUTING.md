# Contributing to QUESTPIE

Thanks for wanting to help. This document is what we actually do, not what we
aspire to — if something here is wrong, that is a bug worth reporting.

## Getting set up

```bash
bun install
bunx turbo run build --filter='./packages/*'
bunx turbo run test --filter='./packages/*'
```

We use **bun 1.3.13** (pinned in `packageManager`) and **turbo**. Node 18+ works for
consuming the published packages, but developing the repo needs bun.

Postgres is needed for some tests. Most suites use in-memory PGlite and need
nothing; the ones that need a real server say so and are gated behind env vars
(`QUESTPIE_REALTIME_TXID_DATABASE_URL`, `QUESTPIE_SOKETI_INTEGRATION`, …). There is
a compose file at `packages/questpie/test/fixtures/soketi/compose.yml` for the
realtime matrix.

## Before you open a PR

Run what CI runs. It is fast except the last one:

```bash
bun run lint                      # 0 errors required; warnings are not gated yet
bunx oxfmt --list-different       # must be empty
bunx turbo run check-types        # all packages
bunx turbo run test --filter='./packages/*'
```

If you touched anything that ships, also:

```bash
bunx turbo run build --filter='./packages/*'
bun run scripts/size-budget.ts    # published size must not grow >5%
bun run scripts/type-budget.ts    # tsc instantiations must not grow >3%
bun run scripts/any-census.ts     # type escapes must not increase
```

## PR size

**Keep a PR to one reviewable change.** This is the one process rule we care most
about, and it is written down because we got it wrong: PR #188 was 763 files and
+144k lines across eight unrelated subsystems. It could not be reviewed, bisected,
or reverted per-piece.

Practically:

- One subsystem per PR. If the title needs "and", it is probably two PRs.
- Mechanical changes (formatting, renames, codegen output) go in their own commit
  or their own PR, never mixed into behavioural work. A 265-file reflow inside a
  logic change is unreviewable.
- If a change genuinely cannot be split, say so in the description and explain why.

## Ratchets

Several gates are _ratchets_: a committed baseline that may go down but not up.

| Gate             | Baseline                      | Meaning                           |
| ---------------- | ----------------------------- | --------------------------------- |
| `any-census`     | `scripts/any-census.json`     | per-package `any`/`as any` counts |
| `type-budget`    | `scripts/type-budget.json`    | tsc Types/Instantiations          |
| `size-budget`    | `scripts/size-budget.json`    | published unpacked size           |
| `example-errors` | `scripts/example-errors.json` | cold tsc errors per example       |

If your change legitimately moves one, re-baseline **in the same PR** with
`--update` and say why in the description. Do not raise a tolerance to make a red
gate green.

Newly created packages are discovered automatically by `any-census` and
`size-budget` and will fail with "missing from baseline" until you baseline them.
That is intentional.

## Conventions

- **Codegen output is committed.** `.generated/` directories are checked in. Never
  hand-edit them — run `bunx turbo run questpie:generate`.
- **Migrations are CLI-generated and immutable.** Use `migrate:generate`; never
  hand-write SQL and never edit a committed migration or its snapshot. They are
  excluded from the formatter for this reason.
- **Package exports come from `src/exports/`.** `tsdown` generates the
  `package.json` `exports` map from those files — hand-edits are overwritten on the
  next build.
- **No internal re-export barrels.** `export *` belongs in `src/exports/` only.
- Commit messages: conventional commits (`feat:`, `fix:`, `chore:`, `ci:`,
  `docs:`, `style:`, `refactor:`, `test:`). Add `!` for a breaking change.

## Changesets

Any change to a published package needs one:

```bash
bun run changeset
```

All `@questpie/*` packages are a **fixed version train** — they release together at
the same version. Pick `patch`/`minor`/`major` for the change itself; the tooling
handles the rest. Write the changeset for someone upgrading: what broke, what to
do about it, and the numbers if you have them.

## Reporting bugs

Use the issue templates. The single most useful thing you can include is a minimal
reproduction — a failing test in the repo beats a description every time.

For anything security-related, **do not open an issue**: see
[SECURITY.md](./SECURITY.md).

## Code of conduct

By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).
