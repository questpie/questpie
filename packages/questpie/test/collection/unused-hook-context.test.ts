import { afterEach, describe, expect, it } from "bun:test";

import { collection, service } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

describe("unused local CRUD hook contexts (QFM-29)", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>> | undefined;

	afterEach(async () => {
		await setup?.cleanup();
	});

	it("reads without materializing full hook contexts for absent or empty hooks, while real callbacks retain their context", async () => {
		const calls: string[] = [];
		let phaseContext: unknown;
		const plain = collection("plain_hook_probes").fields(({ f }) => ({
			title: f.text().required(),
		}));
		const empty = collection("empty_hook_probes")
			.fields(({ f }) => ({ title: f.text().required() }))
			.hooks({ beforeOperation: [], beforeRead: [], afterRead: [] });
		const observed = collection("observed_hook_probes")
			.fields(({ f }) => ({ title: f.text().required() }))
			.hooks({
				beforeOperation: [
					(context) => {
						phaseContext = context;
						const { operation } = context;
						const tables = Reflect.get(context, "tables");
						expect(tables).toHaveProperty("observed");
						calls.push(`before-first:${operation}`);
					},
					(context) => {
						expect(context === phaseContext).toBe(true);
						calls.push(`before-second:${context.operation}`);
					},
				],
				afterRead: (context) => {
					const { data, operation } = context;
					const tables = Reflect.get(context, "tables");
					expect(tables).toHaveProperty("observed");
					expect(data.title).toBe("Observed");
					calls.push(`after:${operation}`);
				},
			});
		setup = await buildMockApp({ collections: { plain, empty, observed } });
		await runTestDbMigrations(setup.app);
		const context = { accessMode: "system" as const };
		const first = await setup.app.collections.plain.create(
			{ title: "Plain" },
			context,
		);
		const second = await setup.app.collections.empty.create(
			{ title: "Empty" },
			context,
		);
		const third = await setup.app.collections.observed.create(
			{ title: "Observed" },
			context,
		);
		calls.length = 0;
		const app = setup.app;
		const descriptor = Object.getOwnPropertyDescriptor(app, "tables");
		const tables = app.tables;
		let extractions = 0;
		Object.defineProperty(app, "tables", {
			configurable: true,
			get: () => {
				extractions++;
				return tables;
			},
		});
		try {
			expect(
				(
					await app.collections.plain.findOne(
						{ where: { id: first.id } },
						context,
					)
				)?.title,
			).toBe("Plain");
			expect(
				(
					await app.collections.empty.findOne(
						{ where: { id: second.id } },
						context,
					)
				)?.title,
			).toBe("Empty");
			expect(extractions).toBe(0);
			expect(
				(
					await app.collections.observed.findOne(
						{ where: { id: third.id } },
						context,
					)
				)?.title,
			).toBe("Observed");
			expect(extractions).toBe(2);
			expect(calls).toEqual([
				"before-first:read",
				"before-second:read",
				"after:read",
			]);
			const failure = new Error("Actual hook context extraction failed");
			Object.defineProperty(app, "tables", {
				configurable: true,
				get: () => {
					throw failure;
				},
			});
			expect(
				(
					await app.collections.plain.findOne(
						{ where: { id: first.id } },
						context,
					)
				)?.title,
			).toBe("Plain");
			expect(
				(
					await app.collections.empty.findOne(
						{ where: { id: second.id } },
						context,
					)
				)?.title,
			).toBe("Empty");
			await expect(
				app.collections.observed.findOne({ where: { id: third.id } }, context),
			).rejects.toBe(failure);
		} finally {
			if (descriptor) Object.defineProperty(app, "tables", descriptor);
			else Reflect.deleteProperty(app, "tables");
		}
	});
	it("keeps beforeValidate input transformation and afterRead output across native CRUD read modes", async () => {
		const validated: string[] = [];
		const observed = collection("transform_hook_probes")
			.fields(({ f }) => ({ title: f.text().required() }))
			.hooks({
				beforeValidate: ({ data, operation }) => {
					data.title = String(data.title ?? "Default").trim();
					validated.push(operation);
				},
				afterRead: ({ data }) => {
					Reflect.set(data, "title", data.title + ":output");
				},
			});
		setup = await buildMockApp({ collections: { observed } });
		await runTestDbMigrations(setup.app);
		const c = setup.app.collections.observed;
		const context = { accessMode: "system" as const };
		const row = await c.create({}, context);
		expect(row.title).toBe("Default:output");
		expect(
			(await c.find({}, context)).docs.map(
				(doc: { title: string }) => doc.title,
			),
		).toEqual(["Default:output"]);
		expect((await c.findOne({ where: { id: row.id } }, context))?.title).toBe(
			"Default:output",
		);
		expect(
			(await c.findRows({ limit: 1 }, context)).map(
				(doc: { title: string }) => doc.title,
			),
		).toEqual(["Default:output"]);
		expect(
			(
				await c.updateById(
					{ id: row.id, data: { title: " Updated " } },
					context,
				)
			).title,
		).toBe("Updated:output");
		expect((await c.findOne({ where: { id: row.id } }, context))?.title).toBe(
			"Updated:output",
		);
		expect(validated).toEqual(["create", "update"]);
	});
	it("retains eager initialization and disposal for request services with empty hook arrays", async () => {
		let created = 0;
		let disposed = 0;
		const requestService = service()
			.lifecycle("request")
			.create(() => ({ id: ++created }))
			.dispose(() => {
				disposed++;
			});
		const empty = collection("request_empty_hook_probes")
			.fields(({ f }) => ({ title: f.text().required() }))
			.hooks({ beforeOperation: [], beforeRead: [], afterRead: [] });
		setup = await buildMockApp({
			collections: { empty },
			services: { requestService },
		});
		await runTestDbMigrations(setup.app);
		expect((await setup.app.collections.empty.find({})).docs).toEqual([]);
		expect(created).toBe(1);
		expect(disposed).toBe(1);
	});
	it("retains singleton namespace projection before a request factory receives session", async () => {
		const decoration = { marker: "existing namespace behavior" };
		const observations: unknown[] = [];
		const decorator = service()
			.namespace("session")
			.create(() => decoration);
		const probe = service()
			.lifecycle("request")
			.create(({ session }) => {
				observations.push(
					(session as Record<string, unknown> | null)?.decorator,
				);
				return {};
			});
		const plain = collection("namespace_hook_probes").fields(({ f }) => ({
			title: f.text(),
		}));
		setup = await buildMockApp({
			collections: { plain },
			services: { decorator, probe },
		});
		await runTestDbMigrations(setup.app);
		await setup.app.collections.plain.find(
			{},
			{
				accessMode: "system",
				session: { marker: "namespace projection input" },
			},
		);
		expect(observations).toEqual([decoration]);
	});
});
