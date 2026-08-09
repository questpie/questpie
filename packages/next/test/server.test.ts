import { afterEach, describe, expect, it } from "bun:test";

import { route } from "../../questpie/src/exports/index.js";
import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import { questpieNext } from "../src/server.js";

describe("next adapter contract", () => {
	let cleanup: (() => Promise<void>) | undefined;

	afterEach(async () => {
		await cleanup?.();
		cleanup = undefined;
	});

	it("defaults to user authority and preserves trusted system compatibility", async () => {
		const inspect = route()
			.get()
			.raw()
			.handler(({ accessMode }) => Response.json({ accessMode }));
		const setup = await buildMockApp({ routes: { inspect } });
		cleanup = setup.cleanup;
		const request = new Request("http://localhost/api/inspect");

		const user = await questpieNext(setup.app, { basePath: "/api" })(request);
		const system = await questpieNext(setup.app, {
			basePath: "/api",
			accessMode: "system",
		})(request);

		expect(await user.json()).toEqual({ accessMode: "user" });
		expect(await system.json()).toEqual({ accessMode: "system" });
	});

	it("owns exact and nested invocation without claiming a sibling as core", async () => {
		const ping = route()
			.get()
			.raw()
			.handler(() => new Response("pong"));
		const setup = await buildMockApp({ routes: { ping } });
		cleanup = setup.cleanup;
		const handler = questpieNext(setup.app, { basePath: "/api" });

		const exact = await handler(new Request("http://localhost/api"));
		const nested = await handler(new Request("http://localhost/api/ping"));
		const sibling = await handler(new Request("http://localhost/apiary"));

		expect((await exact.json()).error.code).toBe("NOT_FOUND");
		expect(await nested.text()).toBe("pong");
		expect(await sibling.json()).toEqual({ error: "Not found" });
	});
});
