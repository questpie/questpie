import { afterEach, describe, expect, it } from "bun:test";

import { z } from "zod";

import { job } from "../../src/exports/services.js";
import { ObservabilityService } from "../../src/server/modules/core/integrated/observability/service.js";
import type {
	ObservabilityAdapter,
	ObservabilityAttributeValue,
	ObservabilitySpan,
} from "../../src/server/modules/core/integrated/observability/types.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

/**
 * The queue seam was the last one with no coverage at all. Every other one —
 * HTTP, CRUD, DB, kv, search, logs — had a test; this one opened `job <name>`
 * spans that nothing ever looked at.
 *
 * Driven through `MockQueueAdapter`, so no Postgres or Redis is needed: the
 * three real adapters all require infrastructure, which is why this could not
 * be folded into the hermetic end-to-end suite.
 */

const recorded = job({
	name: "send-digest",
	schema: z.object({ userId: z.string() }),
	handler: async () => {},
});

const failing = job({
	name: "explode",
	schema: z.object({}),
	handler: async () => {
		throw new Error("handler blew up");
	},
});

interface Recorded {
	name: string;
	kind?: string;
	attributes: Record<string, ObservabilityAttributeValue>;
	ended: boolean;
	failed: boolean;
}

function recorder() {
	const spans: Recorded[] = [];
	const adapter: ObservabilityAdapter = {
		tracer: () => ({
			startActiveSpan(name, options, fn) {
				const rec: Recorded = {
					name,
					kind: options.kind,
					attributes: {
						...(options.attributes ?? {}),
					} as Recorded["attributes"],
					ended: false,
					failed: false,
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
					recordError: () => {
						rec.failed = true;
					},
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

describe("job spans", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	afterEach(async () => {
		await setup?.cleanup();
	});

	it("opens a consumer span named for the job, and ends it", async () => {
		const rec = recorder();
		setup = await buildMockApp({ jobs: { recorded } });
		await runTestDbMigrations(setup.app);
		setup.app.observability = new ObservabilityService({
			adapter: rec.adapter,
		});

		await setup.app.queue["send-digest"].publish({ userId: "u-1" });
		// Register the worker, then let the mock drain — the adapter only knows
		// the handler map once a consumer has started.
		await setup.app.queue.listen();
		await setup.app.mocks.queue.processAllJobs();

		const span = rec.spans.find((s) => s.name === "job send-digest");
		expect(span).toBeDefined();
		expect(span!.ended).toBe(true);
		// `consumer` is how a backend separates queue work from inbound traffic.
		// Getting this wrong files jobs under HTTP throughput.
		expect(span!.kind).toBe("consumer");
		expect(span!.attributes["messaging.operation.name"]).toBe("process");
		expect(span!.attributes["messaging.destination.name"]).toBe("send-digest");
	});

	it("carries the dispatch id, which is what correlates retries", async () => {
		// dispatchId is stable across attempts AND across adapters, so it is the
		// only thing that ties a failed attempt to the one that succeeded.
		const rec = recorder();
		setup = await buildMockApp({ jobs: { recorded } });
		await runTestDbMigrations(setup.app);
		setup.app.observability = new ObservabilityService({
			adapter: rec.adapter,
		});

		await setup.app.queue["send-digest"].publish({ userId: "u-1" });
		// Register the worker, then let the mock drain — the adapter only knows
		// the handler map once a consumer has started.
		await setup.app.queue.listen();
		await setup.app.mocks.queue.processAllJobs();

		const span = rec.spans.find((s) => s.name === "job send-digest")!;
		expect(span.attributes["questpie.job.dispatch_id"]).toBeDefined();
	});

	it("marks the span failed when the handler throws, and still ends it", async () => {
		const rec = recorder();
		setup = await buildMockApp({ jobs: { failing } });
		await runTestDbMigrations(setup.app);
		setup.app.observability = new ObservabilityService({
			adapter: rec.adapter,
		});

		await setup.app.queue.explode.publish({});
		// Register the worker, then let the mock drain — the adapter only knows
		// the handler map once a consumer has started.
		await setup.app.queue.listen();
		await setup.app.mocks.queue.processAllJobs();

		const span = rec.spans.find((s) => s.name === "job explode");
		expect(span).toBeDefined();
		// A span that never ends never reaches a backend at all, so its presence
		// here is the proof the throwing path still closes it.
		expect(span!.ended).toBe(true);
		expect(span!.failed).toBe(true);
	});

	it("runs the handler normally with no adapter configured", async () => {
		const ran: string[] = [];
		const tracked = job({
			name: "tracked",
			schema: z.object({}),
			handler: async () => {
				ran.push("yes");
			},
		});
		setup = await buildMockApp({ jobs: { tracked } });
		await runTestDbMigrations(setup.app);
		setup.app.observability = new ObservabilityService({});

		await setup.app.queue.tracked.publish({});
		// Register the worker, then let the mock drain — the adapter only knows
		// the handler map once a consumer has started.
		await setup.app.queue.listen();
		await setup.app.mocks.queue.processAllJobs();

		expect(ran).toEqual(["yes"]);
	});
});
