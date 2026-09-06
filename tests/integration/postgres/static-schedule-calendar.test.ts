import { afterAll, expect, test } from "bun:test";

import { SQL } from "bun";

import {
	evaluateLatestCronMatch,
	parseUtcCron,
	type UtcCronCalendar,
} from "../../../packages/runtime/src/durable/schedule/contract";
import { expectPostgresMajor } from "./helpers/postgres-major";

const database = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;
const postgresTest = process.env.PGHOST ? test.serial : test.skip;
const MAXIMUM_ORACLE_MINUTES = 10_080;

afterAll(async () => {
	await database?.close({ timeout: 0 });
});

function instant(value: Date | string): Date {
	const parsed = value instanceof Date ? value : new Date(value);
	if (!Number.isFinite(parsed.getTime()))
		throw new TypeError("PostgreSQL returned an invalid UTC instant");
	return parsed;
}

async function postgresLatestMatch(
	program: UtcCronCalendar,
	frontier: Date,
	observedMinute: Date,
): Promise<Date | null> {
	const windowMinutes = Math.max(
		0,
		(observedMinute.getTime() - frontier.getTime()) / 60_000,
	);
	if (
		!Number.isInteger(windowMinutes) ||
		windowMinutes > MAXIMUM_ORACLE_MINUTES
	)
		throw new TypeError("PostgreSQL cron oracle window exceeds its test bound");
	const [row] = await database!.unsafe<
		readonly Readonly<{ match: Date | string | null }>[]
	>(
		`SELECT max(candidate) AS match
		 FROM pg_catalog.generate_series(
		   $1::timestamptz + interval '1 minute',
		   $2::timestamptz,
		   interval '1 minute'
		 ) AS candidate
		 WHERE extract(minute FROM candidate AT TIME ZONE 'UTC')::integer IN
		       (SELECT value::integer FROM pg_catalog.jsonb_array_elements_text(($3::text)::jsonb) AS value)
		   AND extract(hour FROM candidate AT TIME ZONE 'UTC')::integer IN
		       (SELECT value::integer FROM pg_catalog.jsonb_array_elements_text(($4::text)::jsonb) AS value)
		   AND extract(day FROM candidate AT TIME ZONE 'UTC')::integer IN
		       (SELECT value::integer FROM pg_catalog.jsonb_array_elements_text(($5::text)::jsonb) AS value)
		   AND extract(month FROM candidate AT TIME ZONE 'UTC')::integer IN
		       (SELECT value::integer FROM pg_catalog.jsonb_array_elements_text(($6::text)::jsonb) AS value)
		   AND extract(dow FROM candidate AT TIME ZONE 'UTC')::integer IN
		       (SELECT value::integer FROM pg_catalog.jsonb_array_elements_text(($7::text)::jsonb) AS value)`,
		[
			frontier.toISOString(),
			observedMinute.toISOString(),
			JSON.stringify(program.minute),
			JSON.stringify(program.hour),
			JSON.stringify(program.dayOfMonth),
			JSON.stringify(program.month),
			JSON.stringify(program.dayOfWeek),
		],
	);
	return row?.match == null ? null : instant(row.match);
}

async function expectPostgresAgreement(
	expression: string,
	frontier: string,
	observedMinute: string,
) {
	const program = parseUtcCron(expression);
	const frontierDate = new Date(frontier);
	const observedDate = new Date(observedMinute);
	const postgresMatch = await postgresLatestMatch(
		program,
		frontierDate,
		observedDate,
	);
	expect(
		evaluateLatestCronMatch(program, frontierDate, observedDate).match,
	).toEqual(postgresMatch);
	return postgresMatch;
}

postgresTest(
	"uses a SELECT-only calendar oracle on the exact PostgreSQL major",
	async () => {
		const [row] = await database!.unsafe<
			readonly Readonly<{ version: number }>[]
		>("SELECT current_setting('server_version_num')::integer AS version");
		if (!row) throw new Error("PostgreSQL returned no version");
		expectPostgresMajor(row.version);
	},
);

postgresTest("chooses the latest of several PostgreSQL matches", async () => {
	expect(
		await expectPostgresAgreement(
			"*/15 * * * *",
			"2026-09-06T00:00:00.000Z",
			"2026-09-06T01:07:00.000Z",
		),
	).toEqual(new Date("2026-09-06T01:00:00.000Z"));
});

postgresTest(
	"agrees with PostgreSQL UTC at month ends and Gregorian leap boundaries",
	async () => {
		expect(
			await expectPostgresAgreement(
				"47 23 31 * *",
				"2026-01-30T00:00:00.000Z",
				"2026-02-01T00:00:00.000Z",
			),
		).toEqual(new Date("2026-01-31T23:47:00.000Z"));
		expect(
			await expectPostgresAgreement(
				"0 0 29 2 *",
				"2000-02-28T00:00:00.000Z",
				"2000-03-01T00:00:00.000Z",
			),
		).toEqual(new Date("2000-02-29T00:00:00.000Z"));
		expect(
			await expectPostgresAgreement(
				"0 0 29 2 *",
				"2100-02-28T00:00:00.000Z",
				"2100-03-01T00:00:00.000Z",
			),
		).toBeNull();
	},
);

postgresTest(
	"agrees with PostgreSQL weekday and year-one negative-epoch calendars",
	async () => {
		expect(
			await expectPostgresAgreement(
				"0 12 * * 1",
				"2026-09-06T00:00:00.000Z",
				"2026-09-07T12:01:00.000Z",
			),
		).toEqual(new Date("2026-09-07T12:00:00.000Z"));
		expect(
			await expectPostgresAgreement(
				"2 0 * * *",
				"0001-01-01T00:00:00.000Z",
				"0001-01-01T00:03:00.000Z",
			),
		).toEqual(new Date("0001-01-01T00:02:00.000Z"));
	},
);

postgresTest(
	"keeps the frontier exclusive and returns no work after clock regression",
	async () => {
		expect(
			await expectPostgresAgreement(
				"0 0 * * *",
				"2026-09-06T00:00:00.000Z",
				"2026-09-06T00:10:00.000Z",
			),
		).toBeNull();
		expect(
			await expectPostgresAgreement(
				"* * * * *",
				"2026-09-06T00:10:00.000Z",
				"2026-09-06T00:09:00.000Z",
			),
		).toBeNull();
		expect(
			evaluateLatestCronMatch(
				parseUtcCron("* * * * *"),
				new Date("2026-09-06T00:10:00.000Z"),
				new Date("2026-09-06T00:09:00.000Z"),
			),
		).toEqual({ match: null, examinedDays: 0 });
	},
);

postgresTest(
	"evaluates the whole observed UTC minute derived from PostgreSQL clock time",
	async () => {
		const [row] = await database!.unsafe<
			readonly Readonly<{
				observedMinute: Date | string;
				seconds: number;
			}>[]
		>(`WITH observed AS (
		     SELECT date_trunc('minute', clock_timestamp(), 'UTC') AS value
		   )
		   SELECT value AS "observedMinute",
		          extract(second FROM value)::integer AS seconds
		   FROM observed`);
		if (!row) throw new TypeError("PostgreSQL clock oracle returned no row");
		const observedMinute = instant(row.observedMinute);
		expect(row.seconds).toBe(0);
		expect(observedMinute.getUTCSeconds()).toBe(0);
		expect(observedMinute.getUTCMilliseconds()).toBe(0);
		const frontier = new Date(observedMinute.getTime() - 60_000);
		expect(
			evaluateLatestCronMatch(
				parseUtcCron("* * * * *"),
				frontier,
				observedMinute,
			).match,
		).toEqual(observedMinute);
		expect(
			await postgresLatestMatch(
				parseUtcCron("* * * * *"),
				frontier,
				observedMinute,
			),
		).toEqual(observedMinute);
	},
);
