// Lightweight Cron Expression Matcher
//
// Supports standard 5-field cron expressions:
//   minute hour day-of-month month day-of-week
//
// Field syntax:
// - `*` — any value
// - `N` — exact value (e.g., `5`)
// - `N-M` — range (e.g., `1-5`)
// - `N,M` — list (e.g., `1,15,30`)
// - `*/N` — step (e.g., `*/5`)
// - `N-M/S` — range with step (e.g., `0-30/10`)
//
// Day-of-week: 0 = Sunday, 6 = Saturday (also accepts 7 = Sunday).

// ============================================================================
// Types
// ============================================================================

interface CronFields {
	minute: Set<number>;
	hour: Set<number>;
	dayOfMonth: Set<number>;
	month: Set<number>;
	dayOfWeek: Set<number>;
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse a single cron field into a set of matching values.
 */
function parseField(field: string, min: number, max: number): Set<number> {
	const values = new Set<number>();

	for (const part of field.split(",")) {
		const trimmed = part.trim();

		// Step pattern: */N or N-M/S
		if (trimmed.includes("/")) {
			const slashParts = trimmed.split("/");
			const rangePart = slashParts[0] ?? "*";
			const stepStr = slashParts[1] ?? "1";
			const step = Number.parseInt(stepStr, 10);
			if (Number.isNaN(step) || step <= 0) {
				throw new Error(`Invalid cron step: "${trimmed}"`);
			}

			let start = min;
			let end = max;

			if (rangePart !== "*") {
				if (rangePart.includes("-")) {
					const dashParts = rangePart.split("-").map(Number);
					start = dashParts[0] ?? min;
					end = dashParts[1] ?? max;
				} else {
					start = Number.parseInt(rangePart, 10);
				}
			}

			for (let i = start; i <= end; i += step) {
				values.add(i);
			}
		}
		// Range pattern: N-M
		else if (trimmed.includes("-")) {
			const dashParts = trimmed.split("-").map(Number);
			const lo = dashParts[0] ?? min;
			const hi = dashParts[1] ?? max;
			for (let i = lo; i <= hi; i++) {
				values.add(i);
			}
		}
		// Wildcard
		else if (trimmed === "*") {
			for (let i = min; i <= max; i++) {
				values.add(i);
			}
		}
		// Exact value
		else {
			const val = Number.parseInt(trimmed, 10);
			if (Number.isNaN(val)) {
				throw new Error(`Invalid cron value: "${trimmed}"`);
			}
			values.add(val);
		}
	}

	return values;
}

/**
 * Parse a cron expression into structured fields.
 *
 * @param expression - Standard 5-field cron expression
 * @throws If the expression is invalid
 */
export function parseCron(expression: string): CronFields {
	const parts = expression.trim().split(/\s+/);
	if (parts.length !== 5) {
		throw new Error(
			`Invalid cron expression: expected 5 fields, got ${parts.length} in "${expression}"`,
		);
	}

	const fields: CronFields = {
		minute: parseField(parts[0] ?? "*", 0, 59),
		hour: parseField(parts[1] ?? "*", 0, 23),
		dayOfMonth: parseField(parts[2] ?? "*", 1, 31),
		month: parseField(parts[3] ?? "*", 1, 12),
		dayOfWeek: parseField(parts[4] ?? "*", 0, 7),
	};

	// Normalize day-of-week: 7 is also Sunday (same as 0)
	if (fields.dayOfWeek.has(7)) {
		fields.dayOfWeek.add(0);
		fields.dayOfWeek.delete(7);
	}

	return fields;
}

// ============================================================================
// Matching
// ============================================================================

/**
 * Check if a date matches a cron expression.
 *
 * @param expression - Standard 5-field cron expression
 * @param date - The date to check
 * @returns `true` if the date matches the cron expression
 */
export function cronMatches(expression: string, date: Date): boolean {
	const fields = parseCron(expression);

	return (
		fields.minute.has(date.getMinutes()) &&
		fields.hour.has(date.getHours()) &&
		fields.dayOfMonth.has(date.getDate()) &&
		fields.month.has(date.getMonth() + 1) &&
		fields.dayOfWeek.has(date.getDay())
	);
}

/**
 * Check if a cron expression should have fired within a given time window.
 *
 * Checks each minute in the window [windowStart, windowEnd) for a match.
 * This is used by the maintenance job to catch cron triggers that fall
 * within its polling interval.
 *
 * @param expression - Standard 5-field cron expression
 * @param windowStart - Start of the window (inclusive)
 * @param windowEnd - End of the window (exclusive)
 * @returns `true` if the cron should have fired at any minute in the window
 */
export function cronFiredInWindow(
	expression: string,
	windowStart: Date,
	windowEnd: Date,
): boolean {
	const fields = parseCron(expression);

	// Iterate each minute in the window
	const current = new Date(windowStart);
	// Floor to the start of the minute
	current.setSeconds(0, 0);

	while (current < windowEnd) {
		if (
			fields.minute.has(current.getMinutes()) &&
			fields.hour.has(current.getHours()) &&
			fields.dayOfMonth.has(current.getDate()) &&
			fields.month.has(current.getMonth() + 1) &&
			fields.dayOfWeek.has(current.getDay())
		) {
			return true;
		}
		current.setMinutes(current.getMinutes() + 1);
	}

	return false;
}
