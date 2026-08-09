import { afterEach, describe, expect, it } from "bun:test";

import { Elysia } from "elysia";

import { route } from "../../questpie/src/exports/index.js";
import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import { questpieElysia } from "../src/server.js";

describe("elysia adapter composition", () => {
	let cleanup: (() => Promise<void>) | undefined;

	afterEach(async () => {
		await cleanup?.();
		cleanup = undefined;
	});

	it("preserves host lifecycle hooks registered around the plugin", async () => {
		const ping = route()
			.get()
			.raw()
			.handler(() => new Response("pong"));
		const setup = await buildMockApp({ routes: { ping } });
		cleanup = setup.cleanup;
		let afterHandleCalls = 0;
		let laterRequestCalls = 0;
		const native = new Elysia()
			.onAfterHandle(({ response }) => {
				afterHandleCalls++;
				return response;
			})
			.use(questpieElysia(setup.app, { basePath: "/api" }))
			.onRequest(() => {
				laterRequestCalls++;
			})
			.get("/native", () => "native");

		const response = await native.handle(
			new Request("http://localhost/api/ping"),
		);
		const nativeResponse = await native.handle(
			new Request("http://localhost/native"),
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("pong");
		expect(afterHandleCalls).toBe(2);
		expect(laterRequestCalls).toBe(2);
		expect(await nativeResponse.text()).toBe("native");
	});

	it("normalizes root and trailing-slash mounts without claiming siblings", async () => {
		const ping = route()
			.get()
			.raw()
			.handler(() => new Response("pong"));
		const setup = await buildMockApp({ routes: { ping } });
		cleanup = setup.cleanup;
		const nested = new Elysia()
			.use(questpieElysia(setup.app, { basePath: "api/" }))
			.get("/apiary", () => "native sibling");
		const root = new Elysia().use(questpieElysia(setup.app, { basePath: "/" }));

		expect(
			await (
				await nested.handle(new Request("http://localhost/api/ping"))
			).text(),
		).toBe("pong");
		expect(
			await (
				await nested.handle(new Request("http://localhost/apiary"))
			).text(),
		).toBe("native sibling");
		expect(
			await (await root.handle(new Request("http://localhost/ping"))).text(),
		).toBe("pong");
	});
});
