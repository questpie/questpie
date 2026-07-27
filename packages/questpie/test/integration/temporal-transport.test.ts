import { afterAll, describe, expect, test } from "bun:test";

import { createClient, QuestpieClientError } from "../../src/client/index.js";
import { collection } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../utils/test-db.js";

const temporalEvents = collection("temporal_events")
	.fields(({ f }) => ({
		title: f.text().required(),
		startsAt: f.datetime({ withTimezone: true, precision: 3 }).required(),
		dateOnly: f.date().required(),
		schedule: f
			.object({
				startsAt: f.datetime({ withTimezone: true, precision: 3 }).required(),
				label: f.text().required(),
			})
			.required(),
		checkpoints: f.datetime({ withTimezone: true, precision: 3 }).array(),
	}))
	.access({ create: true, read: true, update: true });

describe("temporal transport contract", () => {
	let cleanup: (() => Promise<void>) | undefined;

	afterAll(async () => {
		await cleanup?.();
	});

	test("keeps instants and date-only values stable through CRUD, DB, and HTTP", async () => {
		const setup = await buildMockApp({
			collections: { events: temporalEvents },
		});
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app, { accessMode: "system" });
		const fetcher: typeof fetch = (input, init) =>
			handler(new Request(input, init));
		const client = createClient<any>({
			baseURL: "http://localhost",
			fetch: fetcher,
		});
		const instant = new Date("2026-03-29T00:30:00.000Z");
		const nestedInstant = new Date("2026-03-29T00:30:00.000Z");

		const created = await client.collections.events.create({
			title: "DST boundary",
			startsAt: instant,
			dateOnly: "2026-03-29",
			schedule: { startsAt: nestedInstant, label: "Opening" },
			checkpoints: [instant, nestedInstant],
		});
		expect(created.startsAt).toBeInstanceOf(Date);
		expect(created.startsAt.getTime()).toBe(instant.getTime());
		expect(created.dateOnly).toBe("2026-03-29");
		expect(created.dateOnly).not.toBeInstanceOf(Date);
		expect(created.schedule.startsAt).toBeInstanceOf(Date);
		expect(created.schedule.startsAt.getTime()).toBe(nestedInstant.getTime());
		expect(created.checkpoints).toHaveLength(2);
		expect(created.checkpoints[0]).toBeInstanceOf(Date);
		expect(created.checkpoints[0].getTime()).toBe(instant.getTime());

		const nestedUpdateInstant = new Date("2026-10-25T00:30:00.000Z");
		const nestedUpdated = await client.collections.events.update({
			id: created.id,
			data: {
				schedule: {
					startsAt: nestedUpdateInstant,
					label: "Closing",
				},
				checkpoints: [nestedUpdateInstant],
			},
		});
		expect(nestedUpdated.schedule.startsAt).toBeInstanceOf(Date);
		expect(nestedUpdated.schedule.startsAt.getTime()).toBe(
			nestedUpdateInstant.getTime(),
		);
		expect(nestedUpdated.checkpoints[0]).toBeInstanceOf(Date);
		expect(nestedUpdated.checkpoints[0].getTime()).toBe(
			nestedUpdateInstant.getTime(),
		);

		const externalUpdate = await handler(
			new Request(`http://localhost/events/${created.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					startsAt: "2026-10-25T02:30:00.456+02:00",
					dateOnly: "2026-10-25",
				}),
			}),
		);
		expect(externalUpdate.status).toBe(200);
		const externalJson = (await externalUpdate.json()) as {
			startsAt: string;
			dateOnly: string;
		};
		expect(externalJson.startsAt).toBe("2026-10-25T00:30:00.456Z");
		expect(externalJson.dateOnly).toBe("2026-10-25");

		const readBack = await client.collections.events.findOne({
			where: { id: created.id },
		});
		expect(readBack.startsAt).toBeInstanceOf(Date);
		expect(readBack.startsAt.getTime()).toBe(
			new Date("2026-10-25T00:30:00.456Z").getTime(),
		);
		expect(readBack.dateOnly).toBe("2026-10-25");
		expect(readBack.schedule.startsAt).toBeInstanceOf(Date);
		expect(readBack.schedule.startsAt.getTime()).toBe(
			nestedUpdateInstant.getTime(),
		);

		await expect(
			client.collections.events.update({
				id: created.id,
				data: {
					startsAt: "2026-10-25T02:30:00.456",
				},
			}),
		).rejects.toBeInstanceOf(QuestpieClientError);
		const unchanged = await client.collections.events.findOne({
			where: { id: created.id },
		});
		expect(unchanged.startsAt.getTime()).toBe(
			new Date("2026-10-25T00:30:00.456Z").getTime(),
		);

		await expect(
			client.collections.events.findOne({
				where: {
					startsAt: { eq: "2026-10-25T02:30:00.456" },
				},
			}),
		).rejects.toBeInstanceOf(QuestpieClientError);
		await expect(
			client.collections.events.findOne({
				where: {
					OR: [
						{ dateOnly: { eq: "2026-10-25T00:00:00.000Z" } },
						{ startsAt: { in: ["2026-10-25T02:30:00.456"] } },
					],
				},
			}),
		).rejects.toBeInstanceOf(QuestpieClientError);

		const foundByOffset = await client.collections.events.findOne({
			where: {
				startsAt: { eq: "2026-10-25T02:30:00.456+02:00" },
			},
		});
		expect(foundByOffset.id).toBe(created.id);

		for (const [index, dateOnly] of [
			"2026-01-01",
			"2026-03-29",
			"2026-10-25",
			"2028-02-29",
		].entries()) {
			const dateRecord = await client.collections.events.create({
				title: `Calendar date ${index}`,
				startsAt: instant,
				dateOnly,
				schedule: { startsAt: instant, label: "Midnight-safe" },
				checkpoints: [],
			});
			const dateReadBack = await client.collections.events.findOne({
				where: { id: dateRecord.id },
			});
			expect(dateReadBack.dateOnly).toBe(dateOnly);
			expect(typeof dateReadBack.dateOnly).toBe("string");
		}
	});
});
