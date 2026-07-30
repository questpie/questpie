import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { global } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createMockSession, createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

let afterChangeFacts = 0;
let beforeChangeFacts = 0;

const settings = global("optimistic_settings")
	.fields(({ f }) => ({
		siteName: f.text().required(),
		localizedTitle: f.text().localized(),
	}))
	.options({
		timestamps: false,
		versioning: {
			maxVersions: 3,
			workflow: {
				stages: ["draft", "published"],
				initialStage: "draft",
			},
		},
		optimisticConcurrency: true,
	})
	.hooks({
		beforeChange: () => {
			beforeChangeFacts++;
		},
		afterChange: () => {
			afterChangeFacts++;
		},
	});
const scopedSettings = global("scoped_optimistic_settings")
	.fields(({ f }) => ({ siteName: f.text().required() }))
	.options({
		scoped: ({ session }) => session?.user.id,
		timestamps: false,
		versioning: true,
		optimisticConcurrency: true,
	});

describe("global optimistic concurrency", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	const context = createTestContext({ accessMode: "system" });

	beforeEach(async () => {
		afterChangeFacts = 0;
		beforeChangeFacts = 0;
		setup = await buildMockApp({ globals: { settings, scopedSettings } });
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("creates revision 1 from expected revision 0 and advances once", async () => {
		const created = await setup.app.globals.settings.update(
			{ data: { siteName: "QUESTPIE" }, expectedRevision: 0 },
			context,
		);
		expect(created.revision).toBe(1);

		const updated = await setup.app.globals.settings.update(
			{
				data: { localizedTitle: "Obsah" },
				expectedRevision: 1,
			},
			context,
		);
		expect(updated).toMatchObject({
			siteName: "QUESTPIE",
			localizedTitle: "Obsah",
			revision: 2,
		});
	});

	it("rejects omitted and stale revisions without canonical or history facts", async () => {
		const created = await setup.app.globals.settings.update(
			{ data: { siteName: "QUESTPIE" }, expectedRevision: 0 },
			context,
		);
		const historyBefore = await setup.app.globals.settings.findVersions(
			{ id: created.id },
			context,
		);
		expect(historyBefore).toHaveLength(1);
		expect(historyBefore[0]?.sourceRevision).toBe(1);
		expect(afterChangeFacts).toBe(1);

		for (const input of [
			{ data: { siteName: "Omitted" } },
			{ data: { siteName: "Stale" }, expectedRevision: 0 },
		]) {
			await expect(
				setup.app.globals.settings.update(input as any, context),
			).rejects.toMatchObject({ code: "CONFLICT" });
		}

		const unchanged = await setup.app.globals.settings.get({}, context);
		const historyAfter = await setup.app.globals.settings.findVersions(
			{ id: created.id },
			context,
		);
		expect(unchanged).toMatchObject({ siteName: "QUESTPIE", revision: 1 });
		expect(historyAfter).toHaveLength(1);
		expect(afterChangeFacts).toBe(1);
	});

	it("allows exactly one writer for a shared expected revision", async () => {
		await setup.app.globals.settings.update(
			{ data: { siteName: "Initial" }, expectedRevision: 0 },
			context,
		);

		const outcomes = await Promise.allSettled([
			setup.app.globals.settings.update(
				{ data: { siteName: "Writer A" }, expectedRevision: 1 },
				context,
			),
			setup.app.globals.settings.update(
				{ data: { siteName: "Writer B" }, expectedRevision: 1 },
				context,
			),
		]);
		expect(
			outcomes.filter((outcome) => outcome.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			outcomes.filter((outcome) => outcome.status === "rejected"),
		).toHaveLength(1);
		expect(await setup.app.globals.settings.get({}, context)).toMatchObject({
			revision: 2,
		});
	});

	it("revert and workflow transition each advance once and snapshot sourceRevision", async () => {
		const created = await setup.app.globals.settings.update(
			{ data: { siteName: "Original" }, expectedRevision: 0 },
			context,
		);
		await setup.app.globals.settings.update(
			{ data: { siteName: "Current" }, expectedRevision: 1 },
			context,
		);
		expect(beforeChangeFacts).toBe(2);
		await expect(
			setup.app.globals.settings.revertToVersion(
				{ id: created.id, version: 1, expectedRevision: 1 },
				context,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(beforeChangeFacts).toBe(2);
		const reverted = await setup.app.globals.settings.revertToVersion(
			{ id: created.id, version: 1, expectedRevision: 2 },
			context,
		);
		expect(reverted).toMatchObject({ siteName: "Original", revision: 3 });
		expect(beforeChangeFacts).toBe(3);

		const transitioned = await setup.app.globals.settings.transitionStage(
			{ stage: "published", expectedRevision: 3 },
			context,
		);
		expect(transitioned).toMatchObject({ revision: 4 });
		const versions = await setup.app.globals.settings.findVersions(
			{ id: created.id },
			context,
		);
		expect(versions.map(({ sourceRevision }) => sourceRevision)).toEqual([
			2, 3, 4,
		]);
	});

	it("derives scoped global history and revert access from the current owner", async () => {
		const tenantA = createTestContext({
			accessMode: "user",
			session: createMockSession({ id: "tenant-a" }),
		});
		const tenantB = createTestContext({
			accessMode: "user",
			session: createMockSession({ id: "tenant-b" }),
		});
		const ownerA = await setup.app.globals.scopedSettings.update(
			{ data: { siteName: "Tenant A" }, expectedRevision: 0 },
			tenantA,
		);
		const ownerB = await setup.app.globals.scopedSettings.update(
			{ data: { siteName: "Tenant B" }, expectedRevision: 0 },
			tenantB,
		);

		await expect(
			setup.app.globals.scopedSettings.findVersions({ id: ownerA.id }, tenantB),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			setup.app.globals.scopedSettings.revertToVersion(
				{ id: ownerA.id, version: 1, expectedRevision: ownerB.revision },
				tenantB,
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(
			await setup.app.globals.scopedSettings.get({}, tenantB),
		).toMatchObject({
			id: ownerB.id,
			siteName: "Tenant B",
			revision: 1,
		});
	});

	it("exposes revision ETags and accepts If-Match through global REST", async () => {
		const handler = createFetchHandler(setup.app, { accessMode: "system" });
		const call = (body: unknown, ifMatch?: string) =>
			handler(
				new Request("http://localhost/globals/settings", {
					method: "PATCH",
					headers: {
						"content-type": "application/json",
						...(ifMatch ? { "if-match": ifMatch } : {}),
					},
					body: JSON.stringify(body),
				}),
			);

		const created = await call({
			data: { siteName: "REST" },
			expectedRevision: 0,
		});
		expect(created?.status).toBe(200);
		expect(created?.headers.get("etag")).toBe('"1"');

		const disagreeing = await call(
			{ data: { siteName: "Ambiguous" }, expectedRevision: 0 },
			'"1"',
		);
		expect(disagreeing?.status).toBe(412);

		const updated = await call({ data: { siteName: "HTTP CAS" } }, '"1"');
		expect(updated?.status).toBe(200);
		expect(updated?.headers.get("etag")).toBe('"2"');
		expect(await updated?.json()).toMatchObject({
			siteName: "HTTP CAS",
			revision: 2,
		});
		const stale = await call({ data: { siteName: "Stale" } }, '"1"');
		expect(stale?.status).toBe(412);
	});
});
