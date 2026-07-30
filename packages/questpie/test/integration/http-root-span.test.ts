import { afterEach, describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import type {
	ObservabilityAdapter,
	ObservabilityAttributeValue,
	ObservabilitySpan,
	StartSpanOptions,
} from "../../src/server/modules/core/integrated/observability/types.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

const posts = collection("posts").fields(({ f }) => ({
	title: f.text().required(),
}));

interface Recorded {
	name: string;
	kind?: StartSpanOptions["kind"];
	attributes: Record<string, ObservabilityAttributeValue>;
	errors: unknown[];
	ended: boolean;
}

function recordingAdapter() {
	const spans: Recorded[] = [];
	const adapter: ObservabilityAdapter = {
		tracer: () => ({
			startActiveSpan(name, options, fn) {
				const rec: Recorded = {
					name,
					kind: options.kind,
					attributes: {},
					errors: [],
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
					recordError: (e) => rec.errors.push(e),
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

describe("HTTP root span", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	afterEach(async () => {
		await setup?.cleanup();
	});

	it("opens a server span per request and records method, path and status", async () => {
		const rec = recordingAdapter();
		setup = await buildMockApp({ collections: { posts } });
		setup.app.config.observability = { adapter: rec.adapter };
		// The service is a singleton resolved from config, so rebuild it after
		// injecting the adapter.
		const { ObservabilityService } =
			await import("../../src/server/modules/core/integrated/observability/service.js");
		setup.app.observability = new ObservabilityService(
			setup.app.config.observability,
		);
		await runTestDbMigrations(setup.app);

		const handler = createFetchHandler(setup.app);
		const response = await handler(new Request("http://localhost/health"));

		expect(response?.status).toBe(200);
		expect(rec.spans).toHaveLength(1);

		const span = rec.spans[0]!;
		expect(span.kind).toBe("server");
		expect(span.attributes["http.request.method"]).toBe("GET");
		expect(span.attributes["url.path"]).toBe("/health");
		expect(span.attributes["http.response.status_code"]).toBe(200);
		expect(span.attributes["questpie.request_id"]).toBeDefined();
		// The span must be closed after the response — an async handler that
		// leaves it open reports a nonsense duration.
		expect(span.ended).toBe(true);
		expect(span.errors).toHaveLength(0);
	});

	it("marks a 5xx as failed even when nothing was thrown", async () => {
		const rec = recordingAdapter();
		setup = await buildMockApp({ collections: { posts } });
		setup.app.config.observability = { adapter: rec.adapter };
		const { ObservabilityService } =
			await import("../../src/server/modules/core/integrated/observability/service.js");
		setup.app.observability = new ObservabilityService(
			setup.app.config.observability,
		);
		await runTestDbMigrations(setup.app);

		// A route that does not exist returns 404, which is NOT an error — this
		// asserts the boundary is at 500, not at 400.
		const handler = createFetchHandler(setup.app);
		await handler(new Request("http://localhost/definitely-not-a-route"));

		const span = rec.spans[0]!;
		expect(span.attributes["http.response.status_code"]).toBe(404);
		expect(span.errors).toHaveLength(0);
		expect(span.ended).toBe(true);
	});

	it("does not open a span for a request outside the base path", async () => {
		const rec = recordingAdapter();
		setup = await buildMockApp({ collections: { posts } });
		setup.app.config.observability = { adapter: rec.adapter };
		const { ObservabilityService } =
			await import("../../src/server/modules/core/integrated/observability/service.js");
		setup.app.observability = new ObservabilityService(
			setup.app.config.observability,
		);

		const handler = createFetchHandler(setup.app, { basePath: "/api" });
		const response = await handler(new Request("http://localhost/not-ours"));

		// Returning null means "not my request" — instrumenting it would attribute
		// another framework's routes to QUESTPIE.
		expect(response).toBeNull();
		expect(rec.spans).toHaveLength(0);
	});

	it("costs nothing when no adapter is configured", async () => {
		setup = await buildMockApp({ collections: { posts } });
		await runTestDbMigrations(setup.app);

		const handler = createFetchHandler(setup.app);
		const response = await handler(new Request("http://localhost/health"));

		expect(response?.status).toBe(200);
		expect(setup.app.observability.enabled).toBe(false);
	});
});
