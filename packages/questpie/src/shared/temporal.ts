import { z } from "zod";

const rfc3339InstantStringSchema = z.iso.datetime({ offset: true });
const calendarDateStringSchema = z.iso.date();

export const createInstantInputSchema = () =>
	z.union([
		z.date(),
		rfc3339InstantStringSchema.transform((value) => new Date(value)),
	]);

export function parseRfc3339Instant(value: unknown): Date | null {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value;
	}
	const parsed = rfc3339InstantStringSchema.safeParse(value);
	return parsed.success ? new Date(parsed.data) : null;
}

export function parseCalendarDate(value: unknown): string | null {
	const parsed = calendarDateStringSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

export const currentUtcDateString = (now = new Date()): string =>
	now.toISOString().slice(0, 10);
