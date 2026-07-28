import { describe, expect, it } from "bun:test";

import { ObservabilityService } from "../../../src/server/modules/core/integrated/observability/service.js";
import type {
	Counter,
	Histogram,
	Meter,
	ObservabilityAdapter,
	ObservabilityAttributeValue,
	ObservabilitySpan,
	StartSpanOptions,
	Tracer,
} from "../../../src/server/modules/core/integrated/observability/types.js";

interface RecordedSpan {
	name: string;
	options: StartSpanOptions;
	attributes: Record<string, ObservabilityAttributeValue>;
	errors: unknown[];
	ended: boolean;
}

function fakeAdapter() {
	const spans: RecordedSpan[] = [];
	const counters: Array<{ name: string; value: number }> = [];
	const histograms: Array<{ name: string; value: number }> = [];
	let tracerRequests = 0;

	const tracer: Tracer = {
		startActiveSpan(name, options, fn) {
			const recorded: RecordedSpan = {
				name,
				options,
				attributes: {},
				errors: [],
				ended: false,
			};
			spans.push(recorded);
			const span: ObservabilitySpan = {
				setAttribute(key, value) {
					recorded.attributes[key] = value;
				},
				setAttributes(attributes) {
					for (const [k, v] of Object.entries(attributes)) {
						if (v !== undefined) recorded.attributes[k] = v;
					}
				},
				recordError(error) {
					recorded.errors.push(error);
				},
				addEvent() {},
				end() {
					recorded.ended = true;
				},
			};
			return fn(span);
		},
	};

	const meter: Meter = {
		createCounter(name): Counter {
			return { add: (value) => counters.push({ name, value }) };
		},
		createHistogram(name): Histogram {
			return { record: (value) => histograms.push({ name, value }) };
		},
	};

	let shutdowns = 0;
	const adapter: ObservabilityAdapter = {
		tracer: () => {
			tracerRequests++;
			return tracer;
		},
		meter: () => meter,
		shutdown: async () => {
			shutdowns++;
		},
	};

	return {
		adapter,
		spans,
		counters,
		histograms,
		get tracerRequests() {
			return tracerRequests;
		},
		get shutdowns() {
			return shutdowns;
		},
	};
}

describe("ObservabilityService", () => {
	it("is a no-op with no adapter and still runs the callback", () => {
		const service = new ObservabilityService();

		expect(service.enabled).toBe(false);
		expect(service.span("noop", () => 42)).toBe(42);

		// The no-op span must accept every call rather than throw, or a seam
		// that sets attributes would only work when observability is enabled.
		const result = service.span("noop", (span) => {
			span.setAttribute("a", 1);
			span.setAttributes({ b: "x" });
			span.addEvent("e");
			span.recordError(new Error("ignored"));
			return "ok";
		});
		expect(result).toBe("ok");

		service.meter().createCounter("c").add(1);
		service.meter().createHistogram("h").record(5);
	});

	it("routes spans to the adapter and ends them", () => {
		const fake = fakeAdapter();
		const service = new ObservabilityService({ adapter: fake.adapter });

		expect(service.enabled).toBe(true);
		const value = service.span(
			"collection.find",
			(span) => {
				span.setAttribute("questpie.collection", "posts");
				return 7;
			},
			{ kind: "internal" },
		);

		expect(value).toBe(7);
		expect(fake.spans).toHaveLength(1);
		expect(fake.spans[0]?.name).toBe("collection.find");
		expect(fake.spans[0]?.options.kind).toBe("internal");
		expect(fake.spans[0]?.attributes["questpie.collection"]).toBe("posts");
		expect(fake.spans[0]?.ended).toBe(true);
	});

	it("does not end an async span before the promise settles", async () => {
		const fake = fakeAdapter();
		const service = new ObservabilityService({ adapter: fake.adapter });

		let resolve: (v: string) => void = () => {};
		const pending = new Promise<string>((r) => {
			resolve = r;
		});

		const running = service.span("async.work", () => pending);

		// The whole point: an unawaited span must still be open here, or every
		// async seam would report a near-zero duration.
		expect(fake.spans[0]?.ended).toBe(false);

		resolve("done");
		expect(await running).toBe("done");
		expect(fake.spans[0]?.ended).toBe(true);
	});

	it("records and rethrows sync errors", () => {
		const fake = fakeAdapter();
		const service = new ObservabilityService({ adapter: fake.adapter });
		const boom = new Error("boom");

		expect(() =>
			service.span("failing", () => {
				throw boom;
			}),
		).toThrow(boom);

		expect(fake.spans[0]?.errors).toEqual([boom]);
		expect(fake.spans[0]?.ended).toBe(true);
	});

	it("records and rethrows async rejections", async () => {
		const fake = fakeAdapter();
		const service = new ObservabilityService({ adapter: fake.adapter });
		const boom = new Error("async boom");

		await expect(
			service.span("failing-async", async () => {
				throw boom;
			}),
		).rejects.toThrow(boom);

		expect(fake.spans[0]?.errors).toEqual([boom]);
		expect(fake.spans[0]?.ended).toBe(true);
	});

	it("caches tracers and meters per name", () => {
		const fake = fakeAdapter();
		const service = new ObservabilityService({ adapter: fake.adapter });

		service.tracer("a");
		service.tracer("a");
		service.tracer("b");

		// Instrument creation is not free in a real SDK and the seams ask for
		// the same names on every request.
		expect(fake.tracerRequests).toBe(2);
		expect(service.meter("m")).toBe(service.meter("m"));
	});

	it("forwards shutdown to the adapter", async () => {
		const fake = fakeAdapter();
		const service = new ObservabilityService({ adapter: fake.adapter });

		await service.shutdown();
		expect(fake.shutdowns).toBe(1);

		// And is safe with no adapter — a process shutting down should not need
		// to know whether observability was configured.
		await new ObservabilityService().shutdown();
	});
});
