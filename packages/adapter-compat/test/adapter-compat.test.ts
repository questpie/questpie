import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { text } from "drizzle-orm/pg-core";
import { defineCollection, defineGlobal } from "@questpie/cms/server";
import type { QCMS } from "@questpie/cms/server";
import { questpieElysia } from "@questpie/elysia";
import { questpieHono } from "@questpie/hono";
import { questpieNext } from "@questpie/next";
import { questpieStartHandlers } from "@questpie/tanstack-start";
import {
	closeTestDb,
	createTestDb,
	runTestDbMigrations,
} from "../../cms/test/utils/test-db";
import { createTestCms } from "../../cms/test/utils/test-cms";
import { createMockServices } from "../../cms/test/utils/test-services";

type AdapterHarness = {
	request: (path: string, init?: RequestInit) => Promise<Response>;
	close?: () => Promise<void> | void;
};

type AdapterFactory = (cms: QCMS<any>) => Promise<AdapterHarness> | AdapterHarness;

const jsonRequest = (method: string, body: unknown): RequestInit => ({
	method,
	headers: {
		"Content-Type": "application/json",
	},
	body: JSON.stringify(body),
});

const createRequestFromHandler = (handler: (request: Request) => Promise<Response>) =>
	async (path: string, init: RequestInit = {}) => {
		const request = new Request(`http://localhost${path}`, init);
		return handler(request);
	};

const createStartRequester = (
	handlers: Record<string, (ctx: { request: Request }) => Promise<Response>>,
) =>
	async (path: string, init: RequestInit = {}) => {
		const method = (init.method ?? "GET").toUpperCase();
		const handler = handlers[method];
		if (!handler) {
			return new Response(JSON.stringify({ error: "Not found" }), {
				status: 404,
				headers: { "Content-Type": "application/json" },
			});
		}

		const request = new Request(`http://localhost${path}`, {
			...init,
			method,
		});
		return handler({ request });
	};

const setupCms = async () => {
	const { db, client } = await createTestDb();
	const services = createMockServices();
	services.storage.getUrl = async (key: string) => services.storage.url(key);

	const posts = defineCollection("posts")
		.fields({
			title: text("title").notNull(),
		})
		.options({ softDelete: true })
		.build();

	const settings = defineGlobal("settings")
		.fields({
			siteName: text("site_name"),
		})
		.build();

	const cms = createTestCms([posts], db, services, {
		globals: [settings],
	});
	await runTestDbMigrations(cms);

	return { cms, client };
};

const runAdapterSuite = (name: string, createHarness: AdapterFactory) => {
	describe(name, () => {
		let harness: AdapterHarness;
		let cms: QCMS<any>;
		let client: Awaited<ReturnType<typeof createTestDb>>["client"];

		beforeEach(async () => {
			const setup = await setupCms();
			cms = setup.cms;
			client = setup.client;
			harness = await createHarness(cms);
		});

		afterEach(async () => {
			if (harness?.close) {
				await harness.close();
			}
			await closeTestDb(client);
		});

		it("supports collection CRUD lifecycle", async () => {
			const postId = crypto.randomUUID();
			const createResponse = await harness.request(
				"/cms/posts",
				jsonRequest("POST", { id: postId, title: "Hello" }),
			);
			expect(createResponse.status).toBe(200);
			const created = await createResponse.json();
			expect(created.id).toBe(postId);
			expect(created.title).toBe("Hello");

			const listResponse = await harness.request("/cms/posts?limit=10");
			expect(listResponse.status).toBe(200);
			const list = await listResponse.json();
			expect(list.docs.length).toBe(1);
			expect(list.docs[0].id).toBe(postId);

			const findResponse = await harness.request(`/cms/posts/${postId}`);
			expect(findResponse.status).toBe(200);
			const found = await findResponse.json();
			expect(found.id).toBe(postId);

			const updateResponse = await harness.request(
				`/cms/posts/${postId}`,
				jsonRequest("PATCH", { title: "Updated" }),
			);
			expect(updateResponse.status).toBe(200);
			const updated = await updateResponse.json();
			expect(updated.title).toBe("Updated");

			const deleteResponse = await harness.request(
				`/cms/posts/${postId}`,
				{ method: "DELETE" },
			);
			expect(deleteResponse.status).toBe(200);
			const deleted = await deleteResponse.json();
			expect(deleted.success).toBe(true);

			const restoreResponse = await harness.request(
				`/cms/posts/${postId}/restore`,
				{ method: "POST" },
			);
			expect(restoreResponse.status).toBe(200);
			const restored = await restoreResponse.json();
			expect(restored.id).toBe(postId);
		});

		it("supports globals endpoints", async () => {
			const getResponse = await harness.request("/cms/globals/settings");
			expect(getResponse.status).toBe(200);

			const updateResponse = await harness.request(
				"/cms/globals/settings",
				jsonRequest("PATCH", { siteName: "Questpie" }),
			);
			expect(updateResponse.status).toBe(200);
			const updated = await updateResponse.json();
			expect(updated.siteName).toBe("Questpie");
		});

		it("supports storage upload", async () => {
			const formData = new FormData();
			formData.append(
				"file",
				new File(["hello"], "hello.txt", { type: "text/plain" }),
			);

			const response = await harness.request("/cms/storage/upload", {
				method: "POST",
				body: formData,
			});

			expect(response.status).toBe(200);
			const asset = await response.json();
			expect(asset.filename).toBe("hello.txt");
			expect(asset.mimeType).toBe("text/plain");
		});
	});
};

runAdapterSuite("elysia", async (cms) => {
	const app = questpieElysia(cms, { basePath: "/cms" });
	return {
		request: createRequestFromHandler(app.handle.bind(app)),
	};
});

runAdapterSuite("hono", async (cms) => {
	const app = questpieHono(cms, { basePath: "/cms" });
	return {
		request: (path, init) => app.request(path, init),
	};
});

runAdapterSuite("next", async (cms) => {
	const handler = questpieNext(cms, { basePath: "/cms" });
	return {
		request: createRequestFromHandler(handler),
	};
});

runAdapterSuite("tanstack-start", async (cms) => {
	const handlers = questpieStartHandlers(cms, { basePath: "/cms" });
	return {
		request: createStartRequester(handlers),
	};
});
