---
name: questpie-core/seeds
description:
  QUESTPIE seeds seed() seed.steps() idempotent atomic transaction checkpointed step questpie_seeds questpie_seed_steps category required dev test dependsOn undo SeedContext createContext log autoSeed seed:status seed:undo seed:reset --force --validate --category --only module seeds system mode
  - questpie-core
---

This skill builds on questpie-core.

# Seeds

Seeds write app **data** through the same typed context as routes/hooks/jobs (`collections`, `globals`, `db`, `services`, `email`, `queue`, `storage`, `kv`). Migrations change schema; seeds create rows (first admin, default roles, baseline settings, demo/test fixtures). Drop a file in `seeds/` with a default `export default seed({...})` (from `"questpie"`), run `questpie generate`, then `questpie seed`.

Seeds run in **system mode** by default (bypass access rules, so bootstrap data can be created before any user exists). Completed seeds are recorded in `questpie_seeds` and skipped on later runs unless `--force`.

## `seed()` vs `seed.steps()`

|             | `seed({...})`                                                             | `seed.steps({...})`                                               |
| ----------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Transaction | one seed-wide tx; throw → all DB writes + tracking row roll back together | **no** seed-wide tx; each `step(name, fn)` runs in its own tx     |
| Resume      | re-runs from the top                                                      | completed steps skip; checkpoints stored in `questpie_seed_steps` |
| Use for     | normal bootstrap/demo data                                                | uploads, slow imports, external API calls, large datasets         |

```ts title="seeds/site-settings.ts"
import { seed } from "questpie";

export default seed({
	id: "siteSettings",
	description: "Default site settings",
	category: "required",
	dependsOn: ["roles"], // seed ids that must run first (topologically ordered)
	async run({ globals, createContext, log }) {
		const ctx = await createContext({ accessMode: "system" });
		await globals.siteSettings.update({ siteName: "QUESTPIE" }, ctx);
		log("site settings written");
	},
	async undo({ globals, createContext }) {
		// optional; `questpie seed:undo` calls this, then removes the tracking row
	},
});
```

**Seeds must be idempotent.** Tracking skips already-run seeds, but `--force`, fresh DBs, and `seed:reset` re-enter `run`. Check-if-exists, use stable unique keys, or upsert singletons - never blind-insert duplicates.

### Checkpointed steps

```ts title="seeds/demo-assets.ts"
export default seed.steps({
	id: "demoContent",
	category: "dev",
	async run({ step }) {
		const fixture = await step("prepare", async () => ({
			posts: [{ slug: "demo" }],
		}));
		await step("create", async ({ collections }) => {
			for (const p of fixture.posts) await collections.posts.create(p);
		});
	},
});
```

- `step(name, fn)` runs `fn` with a **transaction-bound** seed context and stores its return value; on re-run a completed step skips and returns the cached value.
- Step results must be **JSON-serializable** (a void step returns `undefined` on replay).
- A step seed has **no seed-wide rollback** - keep all DB mutations inside `step(...)`; work outside a step is neither checkpointed nor rolled back.
- `questpie seed --force` clears that seed's checkpoints (every step re-runs); `seed:reset` also clears them.

## Categories

Every seed has one `category`: `required` (bootstrap data for every env), `dev` (local/preview demo data), `test` (deterministic fixtures). The CLI `--category` filter is **exact** (`--category dev` selects only `dev`), but `dependsOn` can still pull a required dependency from another category into the run set.

## SeedContext

`SeedContext` = full `AppContext` plus `log(message)` and `createContext(options?)`. Seeds run in system mode; use `createContext({ locale, accessMode })` when a CRUD call needs a specific locale (localized globals/collections) or to re-enable access rules.

## autoSeed

`runtimeConfig({ autoSeed })` runs seeds at startup. Shorthand: `true` → all, `"required"` → `required`, `"dev"` → `required`+`dev`, `"test"` → `required`+`test`, `["dev"]` → exactly `dev`, `false`/omitted → none. Use it for bootstrap data that must exist before serving traffic; keep demo/test opt-in.

## CLI

| Command                | Effect                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `questpie seed`        | Run pending seeds                                                                       |
| `questpie seed:status` | List pending + executed seeds                                                           |
| `questpie seed:undo`   | Run `undo` handlers for executed seeds, then remove tracking rows                       |
| `questpie seed:reset`  | Clear tracking rows + step checkpoints (NOT an undo - leaves data, marks seeds pending) |

Options: `--category <required,dev,test>` (`seed`, `seed:undo`), `--only <ids>` (`seed`, `seed:undo`, `seed:reset`), `-f, --force` (re-run despite tracking), `--validate` (run inside a transaction and roll back).

`--validate` rolls back **database** writes only - external side effects (email, HTTP, queue publish, storage) still run. Guard those or keep validation-safe seeds free of them.

## Modules

Modules contribute seeds via `module({ seeds: [...] })`. Seed arrays concatenate across modules (not keyed maps), so make each `id` globally unique.
