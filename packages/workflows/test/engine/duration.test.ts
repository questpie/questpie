import { describe, expect, test } from "bun:test";
import {
	parseDuration,
	resolveDate,
} from "../../src/server/engine/duration.js";

describe("parseDuration", () => {
	describe("valid durations", () => {
		test("parses seconds", () => {
			expect(parseDuration("5s")).toBe(5_000);
			expect(parseDuration("1s")).toBe(1_000);
			expect(parseDuration("60s")).toBe(60_000);
		});

		test("parses minutes", () => {
			expect(parseDuration("3m")).toBe(180_000);
			expect(parseDuration("1m")).toBe(60_000);
			expect(parseDuration("30m")).toBe(1_800_000);
		});

		test("parses hours", () => {
			expect(parseDuration("1h")).toBe(3_600_000);
			expect(parseDuration("24h")).toBe(86_400_000);
		});

		test("parses days", () => {
			expect(parseDuration("3d")).toBe(259_200_000);
			expect(parseDuration("1d")).toBe(86_400_000);
			expect(parseDuration("30d")).toBe(2_592_000_000);
		});

		test("parses weeks", () => {
			expect(parseDuration("1w")).toBe(604_800_000);
			expect(parseDuration("2w")).toBe(1_209_600_000);
		});

		test("parses fractional values", () => {
			expect(parseDuration("1.5h")).toBe(5_400_000);
			expect(parseDuration("0.5d")).toBe(43_200_000);
			expect(parseDuration("2.5s")).toBe(2_500);
		});

		test("parses large values", () => {
			expect(parseDuration("365d")).toBe(31_536_000_000);
			expect(parseDuration("1000s")).toBe(1_000_000);
		});
	});

	describe("invalid durations", () => {
		test("throws on empty string", () => {
			expect(() => parseDuration("")).toThrow("Invalid duration");
		});

		test("throws on missing unit", () => {
			expect(() => parseDuration("5")).toThrow("Invalid duration");
		});

		test("throws on missing value", () => {
			expect(() => parseDuration("s")).toThrow("Invalid duration");
		});

		test("throws on invalid unit", () => {
			expect(() => parseDuration("5x")).toThrow("Invalid duration");
			expect(() => parseDuration("5ms")).toThrow("Invalid duration");
		});

		test("throws on negative value", () => {
			expect(() => parseDuration("-5s")).toThrow("Invalid duration");
		});

		test("throws on whitespace", () => {
			expect(() => parseDuration(" 5s")).toThrow("Invalid duration");
			expect(() => parseDuration("5 s")).toThrow("Invalid duration");
			expect(() => parseDuration("5s ")).toThrow("Invalid duration");
		});

		test("throws on multiple values", () => {
			expect(() => parseDuration("1h30m")).toThrow("Invalid duration");
		});
	});
});

describe("resolveDate", () => {
	test("resolves from a reference date", () => {
		const from = new Date("2026-01-01T00:00:00.000Z");
		const result = resolveDate("5s", from);
		expect(result.getTime()).toBe(from.getTime() + 5_000);
	});

	test("resolves 1 day from reference", () => {
		const from = new Date("2026-01-01T00:00:00.000Z");
		const result = resolveDate("1d", from);
		expect(result.toISOString()).toBe("2026-01-02T00:00:00.000Z");
	});

	test("resolves 1 week from reference", () => {
		const from = new Date("2026-01-01T00:00:00.000Z");
		const result = resolveDate("1w", from);
		expect(result.toISOString()).toBe("2026-01-08T00:00:00.000Z");
	});

	test("defaults to current time when no reference provided", () => {
		const before = Date.now();
		const result = resolveDate("5s");
		const after = Date.now();

		// The resolved date should be approximately 5 seconds in the future
		expect(result.getTime()).toBeGreaterThanOrEqual(before + 5_000);
		expect(result.getTime()).toBeLessThanOrEqual(after + 5_000);
	});

	test("throws on invalid duration", () => {
		expect(() => resolveDate("invalid")).toThrow("Invalid duration");
	});
});
