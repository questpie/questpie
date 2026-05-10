import { describe, expect, it } from "vitest";

import {
	computeNextRunAt,
	cronMatchesInTimezone,
	interpolateTemplate,
} from "../lib/schedules";

describe("schedule helpers", () => {
	it("matches cron expressions in the configured timezone", () => {
		const date = new Date("2026-05-07T10:30:00.000Z");
		expect(
			cronMatchesInTimezone("30 12 * * *", date, "Europe/Bratislava"),
		).toBe(true);
		expect(cronMatchesInTimezone("30 10 * * *", date, "UTC")).toBe(true);
	});

	it("computes the next matching run", () => {
		const next = computeNextRunAt(
			"*/15 * * * *",
			"UTC",
			new Date("2026-05-07T10:07:30.000Z"),
		);
		expect(next?.toISOString()).toBe("2026-05-07T10:15:00.000Z");
	});

	it("interpolates date placeholders", () => {
		expect(
			interpolateTemplate(
				"Daily {{date}} at {{time}}",
				new Date("2026-05-07T10:30:45.000Z"),
			),
		).toBe("Daily 2026-05-07 at 10:30:45");
	});
});
