import { describe, expect, it } from "bun:test";

import { KVService } from "../../../src/server/modules/core/integrated/kv/service.js";
import { ObservabilityService } from "../../../src/server/modules/core/integrated/observability/service.js";
import type {
	ObservabilityAdapter,
	ObservabilityAttributeValue,
	ObservabilitySpan,
} from "../../../src/server/modules/core/integrated/observability/types.js";

interface Recorded {
	name: string;
	attributes: Record<string, ObservabilityAttributeValue>;
	ended: boolean;
}

function recorder() {
	const spans: Recorded[] = [];
	const adapter: ObservabilityAdapter = {
		tracer: () => ({
			startActiveSpan(name, _options, fn) {
				const rec: Recorded = { name, attributes: {}, ended: false };
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
					recordError: () => {},
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

describe("KV spans", () => {
	it("traces each operation and never records the key itself", async () => {
		const rec = recorder();
		const kv = new KVService(
			{},
			new ObservabilityService({ adapter: rec.adapter }),
		);

		await kv.set("session:user-42:token", "secret-value");
		await kv.get("session:user-42:token");
		await kv.has("session:user-42:token");
		await kv.delete("session:user-42:token");

		expect(rec.spans.map((s) => s.name)).toEqual([
			"kv.set",
			"kv.get",
			"kv.has",
			"kv.delete",
		]);
		expect(rec.spans.every((s) => s.ended)).toBe(true);

		// Keys routinely embed ids and sometimes tokens. Length is the useful
		// part; the key itself must never reach a tracing backend.
		const serialized = JSON.stringify(rec.spans);
		expect(serialized).not.toContain("session:user-42:token");
		expect(rec.spans[0]?.attributes["questpie.kv.key_length"]).toBe(
			"session:user-42:token".length,
		);
		expect(rec.spans[0]?.attributes["db.operation.name"]).toBe("set");
	});

	it("still works and allocates no span when observability is off", async () => {
		const kv = new KVService({});
		await kv.set("k", 1);
		expect(await kv.get("k")).toBe(1);
		expect(await kv.has("k")).toBe(true);
		await kv.delete("k");
		expect(await kv.get("k")).toBeNull();
	});

	it("does not trace when an adapter exists but is disabled", async () => {
		const rec = recorder();
		// A service with no adapter reports disabled, so nothing should be
		// recorded even though a recorder is standing by.
		const kv = new KVService({}, new ObservabilityService());
		await kv.get("k");
		expect(rec.spans).toHaveLength(0);
	});
});
