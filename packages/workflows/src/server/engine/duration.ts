/**
 * Duration Parser
 *
 * Parses human-readable duration strings into milliseconds.
 * Supports: seconds (s), minutes (m), hours (h), days (d), weeks (w).
 *
 * @example
 * ```ts
 * parseDuration("5s")  // → 5000
 * parseDuration("3m")  // → 180000
 * parseDuration("1h")  // → 3600000
 * parseDuration("3d")  // → 259200000
 * parseDuration("1w")  // → 604800000
 * ```
 */

import type { Duration } from "../workflow/types.js";

// ============================================================================
// Constants
// ============================================================================

const UNIT_TO_MS: Record<string, number> = {
	s: 1_000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
	w: 604_800_000,
};

const DURATION_REGEX = /^(\d+(?:\.\d+)?)(s|m|h|d|w)$/;

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a duration string into milliseconds.
 *
 * @param duration - Duration string (e.g. "5s", "3m", "1h", "3d", "1w")
 * @returns Milliseconds
 * @throws {Error} If the format is invalid
 */
export function parseDuration(duration: Duration): number {
	const match = DURATION_REGEX.exec(duration);
	if (!match) {
		throw new Error(
			`Invalid duration: "${duration}". Expected format: <number><unit> where unit is one of: s, m, h, d, w`,
		);
	}

	const value = Number.parseFloat(match[1]);
	const unit = match[2];
	const multiplier = UNIT_TO_MS[unit];

	if (value <= 0) {
		throw new Error(`Invalid duration: "${duration}". Value must be positive.`);
	}

	if (!Number.isFinite(value)) {
		throw new Error(
			`Invalid duration: "${duration}". Value must be a finite number.`,
		);
	}

	return Math.round(value * multiplier);
}

/**
 * Resolve a duration string to a future Date from the given reference point.
 *
 * @param duration - Duration string (e.g. "5s", "3m", "1h", "3d", "1w")
 * @param from - Reference point (defaults to now)
 * @returns Future Date
 * @throws {Error} If the duration format is invalid
 */
export function resolveDate(duration: Duration, from?: Date): Date {
	const ms = parseDuration(duration);
	const base = from ?? new Date();
	return new Date(base.getTime() + ms);
}
