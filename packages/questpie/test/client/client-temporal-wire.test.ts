import { describe, expect, test } from "bun:test";

import { createClient } from "../../src/client/index.js";
import {
	parseTypedWire,
	stringifyTypedWire,
} from "../../src/shared/typed-wire.js";

describe("client temporal wire", () => {
	test("preserves nested Date identity through collection mutations and responses", async () => {
		const instant = new Date("2025-03-30T00:30:00.123Z");
		let received: unknown;
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: async (_input, init) => {
				expect(new Headers(init?.headers).get("Content-Type")).toBe(
					"application/superjson+json",
				);
				received = parseTypedWire(String(init?.body));
				return new Response(stringifyTypedWire(received), {
					headers: { "Content-Type": "application/superjson+json" },
				});
			},
		});

		const result = await client.collections.events.create({
			startsAt: instant,
			nested: { reminderAt: instant },
			dateOnly: "2025-03-30",
			isoLookingString: instant.toISOString(),
		});

		expect(received).toEqual({
			startsAt: instant,
			nested: { reminderAt: instant },
			dateOnly: "2025-03-30",
			isoLookingString: instant.toISOString(),
		});
		expect(result.startsAt).toBeInstanceOf(Date);
		expect(result.startsAt.getTime()).toBe(instant.getTime());
		expect(result.nested.reminderAt).toBeInstanceOf(Date);
		expect(result.dateOnly).toBe("2025-03-30");
		expect(result.isoLookingString).toBe(instant.toISOString());
		expect(result.isoLookingString).not.toBeInstanceOf(Date);
	});

	test("uses the same typed body contract for generated custom routes", async () => {
		const instant = new Date("2025-11-02T05:30:00.000Z");
		let received: unknown;
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: async (_input, init) => {
				received = parseTypedWire(String(init?.body));
				return new Response(stringifyTypedWire({ ok: true }), {
					headers: { "Content-Type": "application/superjson+json" },
				});
			},
		});

		await client.routes.schedule.post({
			window: { startsAt: instant },
		});

		expect(received).toEqual({
			window: { startsAt: instant },
		});
	});

	test("keeps explicit plain JSON mode interoperable", async () => {
		const instant = new Date("2025-03-30T00:30:00.123Z");
		let rawBody = "";
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			useSuperJSON: false,
			fetch: async (_input, init) => {
				rawBody = String(init?.body);
				return Response.json(JSON.parse(rawBody));
			},
		});

		const result = await client.collections.events.create({
			startsAt: instant,
			dateOnly: "2025-03-30",
		});

		expect(JSON.parse(rawBody)).toEqual({
			startsAt: instant.toISOString(),
			dateOnly: "2025-03-30",
		});
		expect(result).toEqual({
			startsAt: instant.toISOString(),
			dateOnly: "2025-03-30",
		});
	});
});
