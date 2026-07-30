import { afterEach, describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { extractAppServices } from "../../src/server/config/app-context.js";
import { ObservabilityService } from "../../src/server/modules/core/integrated/observability/service.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";

const posts = collection("posts").fields(({ f }) => ({
	title: f.text().required(),
}));

/**
 * The docs tell users to write `observability.span(...)` inside a route or job
 * handler. That is only true if the service is actually on the handler context —
 * this asserts it, so the documented API cannot quietly stop existing.
 */
describe("observability on the handler context", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	afterEach(async () => {
		await setup?.cleanup();
	});

	it("is exposed to route, job and hook handlers", async () => {
		setup = await buildMockApp({ collections: { posts } });

		const services = extractAppServices(setup.app, {}) as {
			observability?: ObservabilityService;
			logger?: unknown;
		};

		expect(services.observability).toBeInstanceOf(ObservabilityService);
		// Sits alongside logger, which is the service it mirrors.
		expect(services.logger).toBeDefined();
	});

	it("is usable without an adapter", async () => {
		setup = await buildMockApp({ collections: { posts } });

		const { observability } = extractAppServices(setup.app, {}) as {
			observability: ObservabilityService;
		};

		expect(observability.enabled).toBe(false);
		expect(observability.span("userland", () => "value")).toBe("value");
	});
});
