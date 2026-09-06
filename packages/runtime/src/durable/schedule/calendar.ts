const MINUTE_MILLISECONDS = 60_000;
const DAY_MILLISECONDS = 86_400_000;

export const GREGORIAN_CYCLE_DAYS = 146_097;

type CronField = Readonly<{
	label: string;
	minimum: number;
	maximum: number;
}>;

const fields = Object.freeze({
	minute: Object.freeze({ label: "minute", minimum: 0, maximum: 59 }),
	hour: Object.freeze({ label: "hour", minimum: 0, maximum: 23 }),
	dayOfMonth: Object.freeze({
		label: "day of month",
		minimum: 1,
		maximum: 31,
	}),
	month: Object.freeze({ label: "month", minimum: 1, maximum: 12 }),
	dayOfWeek: Object.freeze({
		label: "day of week",
		minimum: 0,
		maximum: 6,
	}),
});

export type UtcCronCalendar = Readonly<{
	canonical: string;
	minute: readonly number[];
	hour: readonly number[];
	dayOfMonth: readonly number[];
	month: readonly number[];
	dayOfWeek: readonly number[];
}>;

function integer(source: string, field: CronField): number {
	if (!/^\d+$/u.test(source))
		throw new TypeError(`cron ${field.label} must be numeric`);
	const value = Number(source);
	if (
		!Number.isSafeInteger(value) ||
		value < field.minimum ||
		value > field.maximum
	)
		throw new TypeError(
			`cron ${field.label} must be between ${field.minimum} and ${field.maximum}`,
		);
	return value;
}

function range(source: string, field: CronField): readonly [number, number] {
	const match = /^(\d+)-(\d+)$/u.exec(source);
	if (!match)
		throw new TypeError(`cron ${field.label} range must be ascending numeric`);
	const lower = integer(match[1]!, field);
	const upper = integer(match[2]!, field);
	if (lower > upper)
		throw new TypeError(`cron ${field.label} range must be ascending`);
	return [lower, upper];
}

function add(values: Set<number>, lower: number, upper: number, step: number) {
	for (let value = lower; value <= upper; value += step) values.add(value);
}

function parseField(source: string, field: CronField): readonly number[] {
	if (source.length === 0 || !/^[\d*,\-/]+$/u.test(source))
		throw new TypeError(`cron ${field.label} has unsupported syntax`);
	const values = new Set<number>();
	for (const member of source.split(",")) {
		if (member.length === 0)
			throw new TypeError(`cron ${field.label} list has an empty member`);
		const stepped = member.split("/");
		if (stepped.length > 2)
			throw new TypeError(`cron ${field.label} has an invalid step`);
		const base = stepped[0]!;
		const stepSource = stepped[1];
		if (stepSource === undefined) {
			if (base === "*") add(values, field.minimum, field.maximum, 1);
			else if (base.includes("-")) {
				const [lower, upper] = range(base, field);
				add(values, lower, upper, 1);
			} else values.add(integer(base, field));
			continue;
		}

		if (base !== "*" && !base.includes("-"))
			throw new TypeError(
				`cron ${field.label} step requires * or an inclusive range`,
			);
		if (!/^\d+$/u.test(stepSource))
			throw new TypeError(`cron ${field.label} step must be positive`);
		const step = Number(stepSource);
		const cardinality = field.maximum - field.minimum + 1;
		if (!Number.isSafeInteger(step) || step < 1 || step > cardinality)
			throw new TypeError(
				`cron ${field.label} step must be between 1 and ${cardinality}`,
			);
		const [lower, upper] =
			base === "*" ? [field.minimum, field.maximum] : range(base, field);
		add(values, lower, upper, step);
	}
	return Object.freeze([...values].sort((left, right) => left - right));
}

function dateMatches(program: UtcCronCalendar, date: Date): boolean {
	return (
		program.month.includes(date.getUTCMonth() + 1) &&
		program.dayOfMonth.includes(date.getUTCDate()) &&
		program.dayOfWeek.includes(date.getUTCDay())
	);
}

function hasGregorianMatch(program: UtcCronCalendar): boolean {
	const firstDay = Date.UTC(2000, 0, 1) / DAY_MILLISECONDS;
	for (let offset = 0; offset < GREGORIAN_CYCLE_DAYS; offset += 1) {
		if (dateMatches(program, new Date((firstDay + offset) * DAY_MILLISECONDS)))
			return true;
	}
	return false;
}

function complete(values: readonly number[], field: CronField): boolean {
	return values.length === field.maximum - field.minimum + 1;
}

export function parseUtcCron(expression: string): UtcCronCalendar {
	const authored = expression.trim().split(/\s+/u);
	if (authored.length !== 5)
		throw new TypeError("cron must contain exactly five numeric fields");
	const minute = parseField(authored[0]!, fields.minute);
	const hour = parseField(authored[1]!, fields.hour);
	const dayOfMonth = parseField(authored[2]!, fields.dayOfMonth);
	const month = parseField(authored[3]!, fields.month);
	const dayOfWeek = parseField(authored[4]!, fields.dayOfWeek);
	if (
		!complete(dayOfMonth, fields.dayOfMonth) &&
		!complete(dayOfWeek, fields.dayOfWeek)
	)
		throw new TypeError(
			"cron day of month or day of week must normalize to its complete set",
		);
	const program = Object.freeze({
		canonical: [minute, hour, dayOfMonth, month, dayOfWeek]
			.map((values) => values.join(","))
			.join(" "),
		minute,
		hour,
		dayOfMonth,
		month,
		dayOfWeek,
	});
	if (!hasGregorianMatch(program))
		throw new TypeError("cron expression has no Gregorian match");
	return program;
}

function minuteInstant(value: Date, label: string): number {
	const instant = value.getTime();
	if (!Number.isFinite(instant)) throw new TypeError(`${label} must be valid`);
	const year = value.getUTCFullYear();
	if (year < 1 || year > 9999)
		throw new TypeError(`${label} must use UTC year 1 through 9999`);
	if (instant % MINUTE_MILLISECONDS !== 0)
		throw new TypeError(`${label} must be a whole UTC minute`);
	return instant;
}

function timeOfDayCandidates(program: UtcCronCalendar): readonly number[] {
	return Object.freeze(
		program.hour.flatMap((hour) =>
			program.minute.map((minute) => hour * 60 + minute),
		),
	);
}

export type LatestCronMatch = Readonly<{
	match: Date | null;
	examinedDays: number;
}>;

export function evaluateLatestCronMatch(
	program: UtcCronCalendar,
	frontier: Date,
	observedMinute: Date,
): LatestCronMatch {
	const frontierInstant = minuteInstant(frontier, "cron frontier");
	const observedInstant = minuteInstant(observedMinute, "cron observation");
	if (observedInstant <= frontierInstant)
		return Object.freeze({ match: null, examinedDays: 0 });

	const frontierDay = Math.floor(frontierInstant / DAY_MILLISECONDS);
	const observedDay = Math.floor(observedInstant / DAY_MILLISECONDS);
	const earliestDay = Math.max(
		frontierDay,
		observedDay - GREGORIAN_CYCLE_DAYS + 1,
	);
	const times = timeOfDayCandidates(program);
	let examinedDays = 0;
	for (let day = observedDay; day >= earliestDay; day -= 1) {
		examinedDays += 1;
		const dayInstant = day * DAY_MILLISECONDS;
		if (!dateMatches(program, new Date(dayInstant))) continue;
		const upper =
			day === observedDay
				? Math.floor((observedInstant - dayInstant) / MINUTE_MILLISECONDS)
				: 24 * 60 - 1;
		const lower =
			day === frontierDay
				? Math.floor((frontierInstant - dayInstant) / MINUTE_MILLISECONDS)
				: -1;
		for (let index = times.length - 1; index >= 0; index -= 1) {
			const candidate = times[index]!;
			if (candidate > upper) continue;
			if (candidate <= lower) break;
			return Object.freeze({
				match: new Date(dayInstant + candidate * MINUTE_MILLISECONDS),
				examinedDays,
			});
		}
	}
	return Object.freeze({ match: null, examinedDays });
}
