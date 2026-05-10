import { parseCron } from "@questpie/workflows/server";

type ParsedCron = ReturnType<typeof parseCron>;

interface LocalDateParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string) {
	const key = timezone || "UTC";
	const cached = formatterCache.get(key);
	if (cached) return cached;
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone: key,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
	formatterCache.set(key, formatter);
	return formatter;
}

function localParts(date: Date, timezone: string): LocalDateParts {
	const parts = formatterFor(timezone).formatToParts(date);
	const values = Object.fromEntries(
		parts
			.filter((part) => part.type !== "literal")
			.map((part) => [part.type, Number(part.value)]),
	);
	const hour = values.hour === 24 ? 0 : (values.hour ?? 0);

	return {
		year: values.year ?? date.getUTCFullYear(),
		month: values.month ?? date.getUTCMonth() + 1,
		day: values.day ?? date.getUTCDate(),
		hour,
		minute: values.minute ?? date.getUTCMinutes(),
	};
}

function dayOfWeek(parts: LocalDateParts) {
	return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

export function cronMatchesInTimezone(
	expression: string,
	date: Date,
	timezone = "UTC",
): boolean {
	const fields = parseCron(expression) as ParsedCron;
	const parts = localParts(date, timezone);

	return (
		fields.minute.has(parts.minute) &&
		fields.hour.has(parts.hour) &&
		fields.dayOfMonth.has(parts.day) &&
		fields.month.has(parts.month) &&
		fields.dayOfWeek.has(dayOfWeek(parts))
	);
}

export function computeNextRunAt(
	expression: string | null | undefined,
	timezone = "UTC",
	from = new Date(),
): Date | null {
	if (!expression?.trim()) return null;

	// Validate up front so invalid expressions are handled consistently.
	parseCron(expression);

	const current = new Date(from);
	current.setSeconds(0, 0);
	current.setMinutes(current.getMinutes() + 1);

	const maxMinutes = 366 * 24 * 60;
	for (let i = 0; i < maxMinutes; i++) {
		if (cronMatchesInTimezone(expression, current, timezone)) {
			return new Date(current);
		}
		current.setMinutes(current.getMinutes() + 1);
	}

	return null;
}

export function interpolateTemplate(text: string, now = new Date()): string {
	const iso = now.toISOString();
	return text
		.replace(/\{\{date\}\}/g, iso.slice(0, 10))
		.replace(/\{\{datetime\}\}/g, iso)
		.replace(/\{\{time\}\}/g, iso.slice(11, 19));
}

export function dateOrNull(value: unknown): Date | null {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(String(value));
	return Number.isNaN(date.getTime()) ? null : date;
}
