import { describe, expect, test } from "bun:test";

import {
	deserializeCompatibleTypedEventWire,
	parseCompatibleTypedEventWire,
	parseTypedWire,
	QUESTPIE_TYPED_EVENT_WIRE_KEY,
	QUESTPIE_TYPED_EVENT_WIRE_VERSION,
	serializeCompatibleTypedEventWire,
	stringifyCompatibleTypedEventWire,
	stringifyTypedWire,
} from "../../src/shared/typed-wire.js";

describe("typed wire codec", () => {
	test("round-trips nested Dates without reviving ordinary ISO strings", () => {
		const instant = new Date("2025-03-30T00:30:00.123Z");
		const dstInstant = new Date("2025-11-02T05:30:00.000Z");
		const isoLookingString = instant.toISOString();

		const decoded = parseTypedWire<{
			instant: Date;
			nested: Array<{ instant: Date }>;
			isoLookingString: string;
		}>(
			stringifyTypedWire({
				instant,
				nested: [{ instant: dstInstant }],
				isoLookingString,
			}),
		);

		expect(decoded.instant).toBeInstanceOf(Date);
		expect(decoded.instant.getTime()).toBe(instant.getTime());
		expect(decoded.nested[0]?.instant).toBeInstanceOf(Date);
		expect(decoded.nested[0]?.instant.getTime()).toBe(dstInstant.getTime());
		expect(decoded.isoLookingString).toBe(isoLookingString);
		expect(decoded.isoLookingString).not.toBeInstanceOf(Date);
	});

	test("adds versioned metadata without changing the legacy event shape", () => {
		const instant = new Date("2025-03-30T00:30:00.123Z");
		const encoded = serializeCompatibleTypedEventWire({
			type: "snapshot",
			data: { instant, label: instant.toISOString() },
		});

		expect(encoded).toMatchObject({
			type: "snapshot",
			data: {
				instant: instant.toISOString(),
				label: instant.toISOString(),
			},
			[QUESTPIE_TYPED_EVENT_WIRE_KEY]: {
				version: QUESTPIE_TYPED_EVENT_WIRE_VERSION,
			},
		});

		const legacyConsumer = JSON.parse(JSON.stringify(encoded));
		expect(legacyConsumer.type).toBe("snapshot");
		expect(legacyConsumer.data.instant).toBe(instant.toISOString());

		const decoded = deserializeCompatibleTypedEventWire<{
			type: string;
			data: { instant: Date; label: string };
		}>(encoded);
		expect(decoded.data.instant).toBeInstanceOf(Date);
		expect(decoded.data.instant.getTime()).toBe(instant.getTime());
		expect(decoded.data.label).toBe(instant.toISOString());
		expect(decoded.data.label).not.toBeInstanceOf(Date);
		expect(decoded).not.toHaveProperty(QUESTPIE_TYPED_EVENT_WIRE_KEY);
	});

	test("parses both typed and legacy event frames", () => {
		const instant = new Date("2025-11-02T05:30:00.000Z");
		const typed = parseCompatibleTypedEventWire<{
			data: { instant: Date };
		}>(
			stringifyCompatibleTypedEventWire({
				data: { instant },
			}),
		);
		expect(typed.data.instant).toBeInstanceOf(Date);
		expect(typed.data.instant.getTime()).toBe(instant.getTime());

		const legacy = parseCompatibleTypedEventWire<{
			data: { instant: string };
		}>(JSON.stringify({ data: { instant: instant.toISOString() } }));
		expect(legacy).toEqual({ data: { instant: instant.toISOString() } });
	});

	test("retains JSON.stringify semantics for every non-Date value", () => {
		const value = {
			undefinedValue: undefined,
			nan: Number.NaN,
			map: new Map([["key", "value"]]),
			error: new Error("boom"),
			invalidDate: new Date(Number.NaN),
			array: [undefined, Number.NaN],
		};

		expect(stringifyCompatibleTypedEventWire(value)).toBe(
			JSON.stringify(value),
		);
		expect(serializeCompatibleTypedEventWire(value)).not.toHaveProperty(
			QUESTPIE_TYPED_EVENT_WIRE_KEY,
		);
	});

	test("adds metadata only for exact valid Date paths", () => {
		const instant = new Date("2026-10-25T00:30:00.000Z");
		const value = {
			nested: [{ instant, sameText: instant.toISOString() }],
			nan: Number.NaN,
		};
		const encoded = serializeCompatibleTypedEventWire(value);

		expect(encoded[QUESTPIE_TYPED_EVENT_WIRE_KEY]).toEqual({
			version: QUESTPIE_TYPED_EVENT_WIRE_VERSION,
			dates: [["nested", "0", "instant"]],
		});
		expect(encoded.nan).toBeNull();
	});

	test("fails like JSON.stringify for cyclic event payloads", () => {
		const value: Record<string, unknown> = {};
		value.self = value;

		expect(() => JSON.stringify(value)).toThrow();
		expect(() => stringifyCompatibleTypedEventWire(value)).toThrow();
	});

	test("rejects unsupported metadata versions instead of guessing", () => {
		expect(() =>
			deserializeCompatibleTypedEventWire({
				type: "snapshot",
				data: {},
				[QUESTPIE_TYPED_EVENT_WIRE_KEY]: {
					version: QUESTPIE_TYPED_EVENT_WIRE_VERSION + 1,
					meta: {},
				},
			}),
		).toThrow("Unsupported QUESTPIE typed event wire version");
	});

	test("rejects invalid, duplicate, and non-canonical Date metadata paths", () => {
		const metadata = {
			version: QUESTPIE_TYPED_EVENT_WIRE_VERSION,
			dates: [["data", "instant"]],
		};
		expect(() =>
			deserializeCompatibleTypedEventWire({
				data: { instant: "2026-03-29T00:30:00Z" },
				[QUESTPIE_TYPED_EVENT_WIRE_KEY]: metadata,
			}),
		).toThrow("Unsupported QUESTPIE typed event wire version");
		expect(() =>
			deserializeCompatibleTypedEventWire({
				data: { instant: "2026-03-29T00:30:00.000Z" },
				[QUESTPIE_TYPED_EVENT_WIRE_KEY]: {
					...metadata,
					dates: [...metadata.dates, ...metadata.dates],
				},
			}),
		).toThrow("Unsupported QUESTPIE typed event wire version");
		expect(() =>
			deserializeCompatibleTypedEventWire({
				data: {},
				[QUESTPIE_TYPED_EVENT_WIRE_KEY]: metadata,
			}),
		).toThrow("Unsupported QUESTPIE typed event wire version");
	});

	test("rejects reserved metadata key collisions", () => {
		expect(() =>
			serializeCompatibleTypedEventWire({
				[QUESTPIE_TYPED_EVENT_WIRE_KEY]: { userValue: true },
			}),
		).toThrow("reserved metadata key");
	});
});
