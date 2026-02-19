import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

const createModule = () => {
	const q = questpie({ name: "adapter-version-routes-test" }).fields(
		defaultFields,
	);

	const posts = q
		.collection("posts")
		.fields((f) => ({
			title: f.text({ required: true }),
		}))
		.options({
			softDelete: true,
			versioning: true,
			workflow: {
				initialStage: "draft",
				stages: {
					draft: { transitions: ["review"] },
					review: { transitions: ["draft", "published"] },
					published: {},
				},
			},
		});

	const settings = q
		.global("settings")
		.fields((f) => ({
			siteName: f.text({ required: true }),
		}))
		.options({
			versioning: true,
			workflow: {
				initialStage: "draft",
				stages: {
					draft: { transitions: ["review"] },
					review: { transitions: ["draft", "published"] },
					published: {},
				},
			},
		});

	return q.collections({ posts }).globals({ settings });
};

describe("adapter versioning routes", () => {
	let setup: Awaited<
		ReturnType<typeof buildMockApp<ReturnType<typeof createModule>>>
	>;

	beforeEach(async () => {
		setup = await buildMockApp(createModule());
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("supports collection versions and revert endpoints", async () => {
		const handler = createFetchHandler(setup.app);

		const createResponse = await handler(
			new Request("http://localhost/posts", {
				method: "POST",
				body: JSON.stringify({ title: "Post v1" }),
			}),
		);

		expect(createResponse?.status).toBe(200);
		const created = (await createResponse?.json()) as { id: string };

		const updateV2 = await handler(
			new Request(`http://localhost/posts/${created.id}`, {
				method: "PATCH",
				body: JSON.stringify({ title: "Post v2" }),
			}),
		);
		expect(updateV2?.status).toBe(200);

		const updateV3 = await handler(
			new Request(`http://localhost/posts/${created.id}`, {
				method: "PATCH",
				body: JSON.stringify({ title: "Post v3" }),
			}),
		);
		expect(updateV3?.status).toBe(200);

		const versionsResponse = await handler(
			new Request(`http://localhost/posts/${created.id}/versions`),
		);
		expect(versionsResponse?.status).toBe(200);

		const versions = (await versionsResponse?.json()) as Array<{
			versionNumber: number;
			versionOperation: string;
		}>;

		expect(Array.isArray(versions)).toBe(true);
		expect(versions.length).toBeGreaterThanOrEqual(3);
		expect(versions[0]?.versionNumber).toBe(1);
		expect(versions[0]?.versionOperation).toBe("create");

		const revertResponse = await handler(
			new Request(`http://localhost/posts/${created.id}/revert`, {
				method: "POST",
				body: JSON.stringify({ version: 1 }),
			}),
		);

		expect(revertResponse?.status).toBe(200);
		const reverted = (await revertResponse?.json()) as { title: string };
		expect(reverted.title).toBe("Post v1");
	});

	it("supports global versions and revert endpoints", async () => {
		const handler = createFetchHandler(setup.app);

		const updateV1 = await handler(
			new Request("http://localhost/globals/settings", {
				method: "PATCH",
				body: JSON.stringify({ siteName: "Site v1" }),
			}),
		);
		expect(updateV1?.status).toBe(200);
		const updatedV1 = (await updateV1?.json()) as { id: string };

		const updateV2 = await handler(
			new Request("http://localhost/globals/settings", {
				method: "PATCH",
				body: JSON.stringify({ siteName: "Site v2" }),
			}),
		);
		expect(updateV2?.status).toBe(200);

		const versionsResponse = await handler(
			new Request(
				`http://localhost/globals/settings/versions?id=${updatedV1.id}`,
			),
		);
		expect(versionsResponse?.status).toBe(200);

		const versions = (await versionsResponse?.json()) as Array<{
			versionNumber: number;
			versionOperation: string;
		}>;

		expect(Array.isArray(versions)).toBe(true);
		expect(versions.length).toBeGreaterThanOrEqual(2);
		expect(versions[0]?.versionNumber).toBe(1);
		expect(versions[0]?.versionOperation).toBe("create");

		const revertResponse = await handler(
			new Request("http://localhost/globals/settings/revert", {
				method: "POST",
				body: JSON.stringify({ version: 1 }),
			}),
		);

		expect(revertResponse?.status).toBe(200);
		const reverted = (await revertResponse?.json()) as { siteName: string };
		expect(reverted.siteName).toBe("Site v1");
	});

	it("resolves workflow stage from query params for collection routes", async () => {
		const handler = createFetchHandler(setup.app);

		const createResponse = await handler(
			new Request("http://localhost/posts", {
				method: "POST",
				body: JSON.stringify({ title: "Draft title" }),
			}),
		);
		expect(createResponse?.status).toBe(200);
		const created = (await createResponse?.json()) as { id: string };

		const moveToReview = await handler(
			new Request(`http://localhost/posts/${created.id}?stage=review`, {
				method: "PATCH",
				body: JSON.stringify({ title: "Review title" }),
			}),
		);
		expect(moveToReview?.status).toBe(200);

		const moveBackToDraft = await handler(
			new Request(`http://localhost/posts/${created.id}?stage=draft`, {
				method: "PATCH",
				body: JSON.stringify({ title: "Draft title v2" }),
			}),
		);
		expect(moveBackToDraft?.status).toBe(200);

		const reviewResponse = await handler(
			new Request(`http://localhost/posts/${created.id}?stage=review`),
		);
		expect(reviewResponse?.status).toBe(200);
		const reviewDoc = (await reviewResponse?.json()) as { title: string };
		expect(reviewDoc.title).toBe("Review title");
	});

	it("resolves workflow stage from query params for global routes", async () => {
		const handler = createFetchHandler(setup.app);

		const draftUpdate = await handler(
			new Request("http://localhost/globals/settings", {
				method: "PATCH",
				body: JSON.stringify({ siteName: "Draft settings" }),
			}),
		);
		expect(draftUpdate?.status).toBe(200);

		const reviewUpdate = await handler(
			new Request("http://localhost/globals/settings?stage=review", {
				method: "PATCH",
				body: JSON.stringify({ siteName: "Review settings" }),
			}),
		);
		expect(reviewUpdate?.status).toBe(200);

		const draftUpdate2 = await handler(
			new Request("http://localhost/globals/settings?stage=draft", {
				method: "PATCH",
				body: JSON.stringify({ siteName: "Draft settings v2" }),
			}),
		);
		expect(draftUpdate2?.status).toBe(200);

		const reviewGet = await handler(
			new Request("http://localhost/globals/settings?stage=review"),
		);
		expect(reviewGet?.status).toBe(200);
		const reviewData = (await reviewGet?.json()) as { siteName: string };
		expect(reviewData.siteName).toBe("Review settings");
	});
});
