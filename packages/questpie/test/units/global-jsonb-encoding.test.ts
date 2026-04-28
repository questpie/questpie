/**
 * Regression test for the jsonb double-encoding bug where calling
 * `globals.<name>.update({ field: [...] })` stored the array as a
 * JSON-encoded string in the jsonb column instead of a jsonb array.
 *
 * Reads via Drizzle were then strings, breaking any consumer that iterated
 * the value as an array.
 */

import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { global } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

describe("globals jsonb encoding", () => {
	describe("plain global with jsonb array field", () => {
		const header_settings = global("header_settings").fields(({ f }) => ({
			menuItems: f
				.object({
					label: f.text().required(),
					link: f.text().required(),
					isExternal: f.boolean(),
				})
				.array()
				.default([] as any),
		}));

		let setup: Awaited<ReturnType<typeof buildMockApp>>;
		let app: any;

		beforeEach(async () => {
			setup = await buildMockApp({ globals: { header_settings } });
			app = setup.app;
			await runTestDbMigrations(app);
		});

		afterEach(async () => {
			await setup.cleanup();
		});

		it("stores jsonb array values as arrays — not as JSON-encoded strings", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			await app.globals.header_settings.update(
				{
					menuItems: [
						{ label: "O nás", link: "/about", isExternal: false },
						{ label: "Kontakt", link: "/contact", isExternal: false },
					],
				},
				ctx,
			);

			const result = await app.db.execute(
				sql`SELECT "menuItems", jsonb_typeof("menuItems") AS t FROM header_settings LIMIT 1`,
			);
			const row = (result.rows ?? result)[0];

			expect(row.t).toBe("array");
			expect(Array.isArray(row.menuItems)).toBe(true);
			expect(row.menuItems).toHaveLength(2);
			expect(row.menuItems[0].label).toBe("O nás");
		});

		it("stores jsonb array values correctly even when the input is a stringified JSON array", async () => {
			// Defensive guarantee: if upstream code (e.g. legacy seed scripts,
			// custom hooks, RPC layers) accidentally passes a JSON-encoded
			// string for a jsonb column, the framework should normalize it
			// rather than store the value as a jsonb string.
			const ctx = createTestContext({ accessMode: "system" });

			const items = [
				{ label: "X", link: "/x", isExternal: false },
				{ label: "Y", link: "/y", isExternal: true },
			];
			await app.globals.header_settings.update(
				{ menuItems: JSON.stringify(items) as any },
				ctx,
			);

			const result = await app.db.execute(
				sql`SELECT "menuItems", jsonb_typeof("menuItems") AS t FROM header_settings LIMIT 1`,
			);
			const row = (result.rows ?? result)[0];

			expect(row.t).toBe("array");
			expect(Array.isArray(row.menuItems)).toBe(true);
			expect(row.menuItems).toHaveLength(2);
			expect(row.menuItems[1].label).toBe("Y");
		});
	});

	describe("hooks see decoded values", () => {
		it("input hooks (beforeChange, beforeUpdate) receive the array, never a JSON string", async () => {
			const seenTypes: string[] = [];
			const seenValues: unknown[] = [];

			const config_with_hook = global("config_with_hook").fields(({ f }) => ({
				items: f
					.json()
					.default([] as any)
					.hooks({
						beforeChange: (value: unknown) => {
							seenTypes.push(
								Array.isArray(value)
									? "array"
									: value === null
										? "null"
										: typeof value,
							);
							seenValues.push(value);
							return value;
						},
					}),
			}));

			const setup = await buildMockApp({ globals: { config_with_hook } });
			const app = setup.app as any;
			await runTestDbMigrations(app);
			try {
				const ctx = createTestContext({ accessMode: "system" });

				// Plain array input — hook must see an array
				await app.globals.config_with_hook.update(
					{ items: [{ a: 1 }, { a: 2 }] },
					ctx,
				);

				// Stringified-array input — hook must STILL see an array
				await app.globals.config_with_hook.update(
					{ items: JSON.stringify([{ a: 3 }]) as any },
					ctx,
				);

				expect(seenTypes).toEqual(["array", "array"]);
				expect(seenValues[0]).toEqual([{ a: 1 }, { a: 2 }]);
				expect(seenValues[1]).toEqual([{ a: 3 }]);
			} finally {
				await setup.cleanup();
			}
		});
	});
});
