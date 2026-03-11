/**
 * Duration Parser
 *
 * Parses human-readable duration strings into milliseconds or absolute Dates.
 * Supports: "Ns" (seconds), "Nm" (minutes), "Nh" (hours), "Nd" (days).
 *
 * @example
 * ```ts
 * parseDuration("5s")   // 5000
 * parseDuration("30m")  // 1_800_000
 * parseDuration("2h")   // 7_200_000
 * parseDuration("3d")   // 259_200_000
 * parseDuration("1d12h") // 129_600_000
 * ```
 */

const UNITS: Record<string, number> = {
	s: 1_000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
};

/**
 * Parse a duration string into milliseconds.
 * Supports compound durations like "1d12h30m".
 *
 * @throws Error if the duration string is invalid
 */
export function parseDuration(duration: string): number {
	if (!duration || typeof duration !== "string") {
		throw new Error(`Invalid duration: "${duration}". Expected format like "5s", "30m", "2h", "3d".`);
	}

	const pattern = /(\d+)\s*([smhd])/gi;
	let totalMs = 0;
	let matched = false;

	let match: RegExpExecArray | null;
	while ((match = pattern.exec(duration)) !== null) {
		const value = Number.parseInt(match[1], 10);
		const unit = match[2].toLowerCase();
		const multiplier = UNITS[unit];
		if (!multiplier) {
			throw new Error(
				`Invalid duration unit "${unit}" in "${duration}". Supported: s, m, h, d.`,
			);
		}
		totalMs += value * multiplier;
		matched = true;
	}

	if (!matched) {
		throw new Error(
			`Invalid duration: "${duration}". Expected format like "5s", "30m", "2h", "3d".`,
		);
	}

	return totalMs;
}

/**
 * Parse a duration string and return a Date that is `duration` from now.
 */
export function durationFromNow(duration: string): Date {
	return new Date(Date.now() + parseDuration(duration));
}
