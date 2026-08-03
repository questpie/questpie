import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TEMPLATES = ["hono", "elysia", "next", "tanstack-start"] as const;

const config = (template: string) =>
	readFileSync(
		join(
			import.meta.dir,
			"..",
			"templates",
			template,
			"src/questpie/server/questpie.config.ts",
		),
		"utf8",
	);

/**
 * `migrate:create` and `migrate` have to agree on one directory, and they only
 * do so by default.
 *
 * `questpie migrate:create` writes to `cli.migrations.directory` when that key
 * is set, and to `<serverRoot>/migrations` when it is not
 * (cli/commands/generate.ts:148-150). Codegen only ever scans
 * `<serverRoot>/migrations` (cli/codegen/index.ts, category `migrations`), and
 * `questpie migrate` runs the array codegen emitted.
 *
 * Every template used to set the key to `./src/migrations`. So on a fresh
 * project you could create a migration and then watch `bun run migrate` print
 * "No migrations found". The search adapter's index migrations live inside
 * `migrations.up()`, so those were skipped too, which is where CREATE EXTENSION
 * for pg_trgm and pgvector would have run.
 */
describe("templates leave the migration directory at its default", () => {
	for (const template of TEMPLATES) {
		it(`${template} does not set cli.migrations.directory`, () => {
			// Any spelling of the key, not just the one the templates used.
			expect(config(template)).not.toMatch(/migrations\s*:\s*\{/);
			expect(config(template)).not.toMatch(/cli\s*:\s*\{/);
		});
	}

	it("keeps the rest of the runtime config", () => {
		// Guards against the key being removed by deleting the whole config.
		const hono = config("hono");
		expect(hono).toContain("runtimeConfig(");
		expect(hono).toContain("db: { url: env.DATABASE_URL }");
	});
});
