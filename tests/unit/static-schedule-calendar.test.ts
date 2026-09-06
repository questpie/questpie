import { expect, test } from "bun:test";

import {
	evaluateLatestCronMatch,
	parseUtcCron,
} from "../../packages/runtime/src/durable/schedule/contract";

test("canonicalizes complete numeric fields, lists, ranges, and anchored steps", () => {
	const expanded = parseUtcCron("0,15,30,45 0,12 1-31 1-12 0,1,2,3,4,5,6");
	const stepped = parseUtcCron("*/15 0-12/12 * * *");
	expect(stepped).toEqual(expanded);
	expect(stepped.canonical).toBe(
		"0,15,30,45 0,12 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31 1,2,3,4,5,6,7,8,9,10,11,12 0,1,2,3,4,5,6",
	);
	expect(parseUtcCron("1-9/4 5 * * *").minute).toEqual([1, 5, 9]);
});

test("rejects syntax outside the exact five-field numeric grammar", () => {
	for (const expression of [
		"0 0 * *",
		"0 0 * * * 2026",
		"@daily",
		"zero 0 * * *",
		"0 0 * JAN *",
		"0 0 * * 7",
		"0 0 * * -1",
		"0 23-2 * * *",
		"0 0 * * */0",
		"0 0 * * */8",
		"5/2 0 * * *",
		"0 0 * * 1,,2",
		"0 0 ? * *",
	]) {
		expect(() => parseUtcCron(expression)).toThrow();
	}
});

test("requires one normalized complete day field", () => {
	expect(() => parseUtcCron("0 0 1 * 1")).toThrow(
		"day of month or day of week",
	);
	expect(parseUtcCron("0 0 1-31 * 1").dayOfMonth).toHaveLength(31);
	expect(parseUtcCron("0 0 1 * 0-6").dayOfWeek).toHaveLength(7);
});

test("rejects impossible Gregorian dates but retains leap-day programs", () => {
	for (const expression of ["0 0 30 2 *", "0 0 31 2 *", "0 0 31 4,6,9,11 *"]) {
		expect(() => parseUtcCron(expression)).toThrow("no Gregorian match");
	}
	expect(parseUtcCron("0 0 29 2 *").dayOfMonth).toEqual([29]);
});

test("selects the latest UTC match in the exclusive-inclusive frontier window", () => {
	const everyQuarterHour = parseUtcCron("*/15 * * * *");
	expect(
		evaluateLatestCronMatch(
			everyQuarterHour,
			new Date("2026-09-06T10:15:00.000Z"),
			new Date("2026-09-06T10:47:00.000Z"),
		).match,
	).toEqual(new Date("2026-09-06T10:45:00.000Z"));
	expect(
		evaluateLatestCronMatch(
			everyQuarterHour,
			new Date("2026-09-06T10:45:00.000Z"),
			new Date("2026-09-06T10:45:00.000Z"),
		).match,
	).toBeNull();
});

test("bounds a centuries-long outage by Gregorian days, never missed minutes", () => {
	const leapDay = parseUtcCron("59 23 29 2 *");
	const result = evaluateLatestCronMatch(
		leapDay,
		new Date("2000-01-01T00:00:00.000Z"),
		new Date("2400-03-01T00:00:00.000Z"),
	);
	expect(result.match).toEqual(new Date("2400-02-29T23:59:00.000Z"));
	expect(result.examinedDays).toBeLessThanOrEqual(146_097);
	expect(result.examinedDays).toBeLessThan(370);
});

test("distinguishes the 2100 century exception from the 2400 leap year", () => {
	const leapDay = parseUtcCron("0 0 29 2 *");
	expect(
		evaluateLatestCronMatch(
			leapDay,
			new Date("2095-01-01T00:00:00.000Z"),
			new Date("2104-02-28T23:59:00.000Z"),
		).match,
	).toEqual(new Date("2096-02-29T00:00:00.000Z"));
	expect(
		evaluateLatestCronMatch(
			leapDay,
			new Date("2399-01-01T00:00:00.000Z"),
			new Date("2400-03-01T00:00:00.000Z"),
		).match,
	).toEqual(new Date("2400-02-29T00:00:00.000Z"));
});

test("handles the lower and upper supported UTC year boundaries", () => {
	const newYear = parseUtcCron("0 0 1 1 *");
	expect(
		evaluateLatestCronMatch(
			newYear,
			new Date("0001-12-31T00:00:00.000Z"),
			new Date("0002-01-01T00:00:00.000Z"),
		).match,
	).toEqual(new Date("0002-01-01T00:00:00.000Z"));
	const everyMinute = parseUtcCron("* * * * *");
	expect(
		evaluateLatestCronMatch(
			everyMinute,
			new Date("9999-12-31T23:58:00.000Z"),
			new Date("9999-12-31T23:59:00.000Z"),
		).match,
	).toEqual(new Date("9999-12-31T23:59:00.000Z"));
	expect(() =>
		evaluateLatestCronMatch(
			everyMinute,
			new Date("9999-12-31T23:59:00.000Z"),
			new Date("+010000-01-01T00:00:00.000Z"),
		),
	).toThrow("year 1 through 9999");
});

test("currently normalizes JavaScript Unicode whitespace between fields", () => {
	expect(parseUtcCron("\u00a0*/15\t0-12/12\n*\r*\f* ")).toEqual(
		parseUtcCron("*/15 0-12/12 * * *"),
	);
});

test("uses UTC weekday fields and rejects non-minute or unsupported-year inputs", () => {
	const sunday = parseUtcCron("0 0 * * 0");
	expect(
		evaluateLatestCronMatch(
			sunday,
			new Date("2026-09-01T00:00:00.000Z"),
			new Date("2026-09-06T00:00:00.000Z"),
		).match,
	).toEqual(new Date("2026-09-06T00:00:00.000Z"));
	expect(() =>
		evaluateLatestCronMatch(
			sunday,
			new Date("2026-09-01T00:00:00.001Z"),
			new Date("2026-09-06T00:00:00.000Z"),
		),
	).toThrow("whole UTC minute");
	expect(() =>
		evaluateLatestCronMatch(
			sunday,
			new Date("0000-01-01T00:00:00.000Z"),
			new Date("2026-09-06T00:00:00.000Z"),
		),
	).toThrow("year 1 through 9999");
});

test("agrees with a bounded minute oracle across month, weekday, and step edges", () => {
	const cases = [
		parseUtcCron("7-47/20 5,17 31 1,3,5,7,8,10,12 *"),
		parseUtcCron("13 22 * 2 1"),
		parseUtcCron("1,59 0-23/7 29 2 *"),
	];
	const frontier = new Date("2024-01-01T00:00:00.000Z");
	const observed = new Date("2024-03-31T23:59:00.000Z");
	const exhaustive = (program: (typeof cases)[number]): Date | null => {
		for (
			let instant = observed.getTime();
			instant > frontier.getTime();
			instant -= 60_000
		) {
			const candidate = new Date(instant);
			if (
				program.minute.includes(candidate.getUTCMinutes()) &&
				program.hour.includes(candidate.getUTCHours()) &&
				program.dayOfMonth.includes(candidate.getUTCDate()) &&
				program.month.includes(candidate.getUTCMonth() + 1) &&
				program.dayOfWeek.includes(candidate.getUTCDay())
			)
				return candidate;
		}
		return null;
	};
	for (const program of cases)
		expect(evaluateLatestCronMatch(program, frontier, observed).match).toEqual(
			exhaustive(program),
		);

	expect(
		evaluateLatestCronMatch(
			cases[0]!,
			observed,
			new Date("2024-03-01T00:00:00.000Z"),
		),
	).toEqual({ match: null, examinedDays: 0 });
});
