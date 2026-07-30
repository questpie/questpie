import { describe, expect, it } from "bun:test";

import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";

import { instrumentDbClient } from "../../src/server/db/instrument.js";
import { ObservabilityService } from "../../src/server/modules/core/integrated/observability/service.js";
import type {
	ObservabilityAdapter,
	ObservabilityAttributeValue,
	ObservabilitySpan,
} from "../../src/server/modules/core/integrated/observability/types.js";

const rows = pgTable("span_probe", {
	id: text("id").primaryKey(),
	age: integer("age"),
});

interface Recorded {
	name: string;
	attributes: Record<string, ObservabilityAttributeValue>;
	ended: boolean;
}

function recorder() {
	const spans: Recorded[] = [];
	const adapter: ObservabilityAdapter = {
		tracer: () => ({
			startActiveSpan(name, options, fn) {
				const rec: Recorded = {
					name,
					attributes: {
						...(options.attributes ?? {}),
					} as Recorded["attributes"],
					ended: false,
				};
				spans.push(rec);
				const span: ObservabilitySpan = {
					setAttribute: (k, v) => {
						rec.attributes[k] = v;
					},
					setAttributes: (attrs) => {
						for (const [k, v] of Object.entries(attrs)) {
							if (v !== undefined) rec.attributes[k] = v;
						}
					},
					recordError: () => {},
					addEvent: () => {},
					end: () => {
						rec.ended = true;
					},
				};
				return fn(span);
			},
		}),
		meter: () => ({
			createCounter: () => ({ add: () => {} }),
			createHistogram: () => ({ record: () => {} }),
		}),
		shutdown: async () => {},
	};
	return { adapter, spans };
}

async function harness(observability: ObservabilityService) {
	const client = await PGlite.create();
	const db = drizzle(client, { schema: { rows } });
	await db.execute(
		sql`CREATE TABLE span_probe (id text primary key, age integer)`,
	);
	return instrumentDbClient(db, observability);
}

describe("DB query spans", () => {
	it("spans a builder query, and ends it", async () => {
		const rec = recorder();
		const db = await harness(
			new ObservabilityService({ adapter: rec.adapter }),
		);

		await db.select().from(rows);

		const span = rec.spans.find((s) => s.name === "db.select");
		expect(span).toBeDefined();
		expect(span!.ended).toBe(true);
		expect(span!.attributes["db.system"]).toBe("postgresql");
		expect(span!.attributes["db.sql.table"]).toBe("span_probe");
	});

	it("spans a raw execute", async () => {
		const rec = recorder();
		const db = await harness(
			new ObservabilityService({ adapter: rec.adapter }),
		);

		await db.execute(sql`SELECT 1`);

		expect(rec.spans.some((s) => s.name === "db.select")).toBe(true);
	});

	it("spans statements INSIDE a transaction, not just the transaction", async () => {
		// The failure this guards against: `transaction()` hands the callback a
		// `tx` with its own session. Wrap only the outer one and every statement
		// in the transaction is invisible — which is where the latency lives.
		const rec = recorder();
		const db = await harness(
			new ObservabilityService({ adapter: rec.adapter }),
		);

		await db.transaction(async (tx) => {
			await tx.insert(rows).values({ id: "a", age: 1 });
			await tx.select().from(rows);
		});

		expect(rec.spans.some((s) => s.name === "db.transaction")).toBe(true);
		expect(rec.spans.some((s) => s.name === "db.insert")).toBe(true);
		const inserted = rec.spans.find((s) => s.name === "db.insert");
		expect(inserted!.ended).toBe(true);
	});

	it("never attaches query parameters", async () => {
		// Params are user data. The SQL text is fine; the values are not, and a
		// tracing backend is not a place to leak them.
		const rec = recorder();
		const db = await harness(
			new ObservabilityService({ adapter: rec.adapter }),
		);

		await db.insert(rows).values({ id: "secret-id-value", age: 42 });

		const serialised = JSON.stringify(rec.spans);
		expect(serialised).not.toContain("secret-id-value");
	});

	it("rolls back correctly while instrumented", async () => {
		const rec = recorder();
		const db = await harness(
			new ObservabilityService({ adapter: rec.adapter }),
		);

		await expect(
			db.transaction(async (tx) => {
				await tx.insert(rows).values({ id: "b", age: 2 });
				throw new Error("rollback me");
			}),
		).rejects.toThrow("rollback me");

		expect(await db.select().from(rows)).toHaveLength(0);
	});

	it("is a no-op with no adapter — same client back, no wrapping cost", async () => {
		const noop = new ObservabilityService({});
		const client = await PGlite.create();
		const db = drizzle(client, { schema: { rows } });
		const before = db.session;

		expect(instrumentDbClient(db, noop)).toBe(db);
		expect(db.session).toBe(before);
	});
});
