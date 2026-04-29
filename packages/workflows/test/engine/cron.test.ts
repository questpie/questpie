import { describe, expect, test } from "bun:test";
import {
	cronFiredInWindow,
	cronMatches,
	parseCron,
} from "../../src/server/engine/cron.js";

describe("parseCron", () => {
	test("parses a simple every-5-minutes expression", () => {
		const fields = parseCron("*/5 * * * *");
		expect(fields.minute.has(0)).toBe(true);
		expect(fields.minute.has(5)).toBe(true);
		expect(fields.minute.has(10)).toBe(true);
		expect(fields.minute.has(55)).toBe(true);
		expect(fields.minute.has(3)).toBe(false);
		expect(fields.hour.size).toBe(24);
		expect(fields.dayOfMonth.size).toBe(31);
		expect(fields.month.size).toBe(12);
		expect(fields.dayOfWeek.size).toBe(7);
	});

	test("parses exact values", () => {
		const fields = parseCron("0 9 * * *");
		expect(fields.minute.size).toBe(1);
		expect(fields.minute.has(0)).toBe(true);
		expect(fields.hour.size).toBe(1);
		expect(fields.hour.has(9)).toBe(true);
	});

	test("parses ranges", () => {
		const fields = parseCron("0-10 * * * *");
		expect(fields.minute.size).toBe(11);
		expect(fields.minute.has(0)).toBe(true);
		expect(fields.minute.has(10)).toBe(true);
		expect(fields.minute.has(11)).toBe(false);
	});

	test("parses lists", () => {
		const fields = parseCron("0,15,30,45 * * * *");
		expect(fields.minute.size).toBe(4);
		expect(fields.minute.has(0)).toBe(true);
		expect(fields.minute.has(15)).toBe(true);
		expect(fields.minute.has(30)).toBe(true);
		expect(fields.minute.has(45)).toBe(true);
	});

	test("parses range with step", () => {
		const fields = parseCron("0-30/10 * * * *");
		expect(fields.minute.has(0)).toBe(true);
		expect(fields.minute.has(10)).toBe(true);
		expect(fields.minute.has(20)).toBe(true);
		expect(fields.minute.has(30)).toBe(true);
		expect(fields.minute.has(5)).toBe(false);
	});

	test("normalizes day-of-week 7 to 0 (Sunday)", () => {
		const fields = parseCron("* * * * 7");
		expect(fields.dayOfWeek.has(0)).toBe(true);
		expect(fields.dayOfWeek.has(7)).toBe(false);
	});

	test("throws on invalid expression (wrong number of fields)", () => {
		expect(() => parseCron("*/5 * *")).toThrow("expected 5 fields");
	});

	test("throws on invalid step", () => {
		expect(() => parseCron("*/0 * * * *")).toThrow("Invalid cron step");
	});
});

describe("cronMatches", () => {
	test("matches every-minute expression", () => {
		const date = new Date(2026, 2, 13, 10, 30, 0); // March 13, 2026 10:30 (Friday)
		expect(cronMatches("* * * * *", date)).toBe(true);
	});

	test("matches exact time", () => {
		const date = new Date(2026, 2, 13, 9, 0, 0); // March 13, 2026 09:00
		expect(cronMatches("0 9 * * *", date)).toBe(true);
		expect(cronMatches("0 10 * * *", date)).toBe(false);
	});

	test("matches every 5 minutes", () => {
		const date1 = new Date(2026, 2, 13, 10, 0, 0);
		const date2 = new Date(2026, 2, 13, 10, 5, 0);
		const date3 = new Date(2026, 2, 13, 10, 3, 0);
		expect(cronMatches("*/5 * * * *", date1)).toBe(true);
		expect(cronMatches("*/5 * * * *", date2)).toBe(true);
		expect(cronMatches("*/5 * * * *", date3)).toBe(false);
	});

	test("matches specific day of week", () => {
		// March 13, 2026 is a Friday (day 5)
		const friday = new Date(2026, 2, 13, 10, 0, 0);
		expect(cronMatches("0 10 * * 5", friday)).toBe(true);
		expect(cronMatches("0 10 * * 1", friday)).toBe(false); // Monday
	});

	test("matches specific month and day", () => {
		const date = new Date(2026, 11, 25, 0, 0, 0); // Dec 25
		expect(cronMatches("0 0 25 12 *", date)).toBe(true);
		expect(cronMatches("0 0 25 11 *", date)).toBe(false); // Nov 25
	});
});

describe("cronFiredInWindow", () => {
	test("detects cron fire within 5-minute window", () => {
		// Window: 10:00 - 10:05
		const start = new Date(2026, 2, 13, 10, 0, 0);
		const end = new Date(2026, 2, 13, 10, 5, 0);

		// Expression: every hour at :00 → should fire at 10:00
		expect(cronFiredInWindow("0 * * * *", start, end)).toBe(true);

		// Expression: every hour at :30 → should NOT fire
		expect(cronFiredInWindow("30 * * * *", start, end)).toBe(false);
	});

	test("detects cron fire at minute boundary", () => {
		const start = new Date(2026, 2, 13, 9, 55, 0);
		const end = new Date(2026, 2, 13, 10, 0, 0);

		// "0 10 * * *" fires at 10:00 — but window is [9:55, 10:00)
		// 10:00 is exclusive, so it should NOT match
		expect(cronFiredInWindow("0 10 * * *", start, end)).toBe(false);

		// Make window inclusive of 10:00
		const endInclusive = new Date(2026, 2, 13, 10, 1, 0);
		expect(cronFiredInWindow("0 10 * * *", start, endInclusive)).toBe(true);
	});

	test("detects multiple fires in a large window", () => {
		// Window: 1 hour
		const start = new Date(2026, 2, 13, 10, 0, 0);
		const end = new Date(2026, 2, 13, 11, 0, 0);

		// "*/15 * * * *" fires at :00, :15, :30, :45
		expect(cronFiredInWindow("*/15 * * * *", start, end)).toBe(true);
	});

	test("returns false for empty window", () => {
		const date = new Date(2026, 2, 13, 10, 0, 0);
		expect(cronFiredInWindow("* * * * *", date, date)).toBe(false);
	});
});
