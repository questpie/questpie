type DurationUnit = "d" | "h" | "m" | "ms" | "s";

const unitMilliseconds: Readonly<Record<DurationUnit, number>> = Object.freeze({
	d: 86_400_000,
	h: 3_600_000,
	m: 60_000,
	ms: 1,
	s: 1_000,
});

/** The accepted retry horizon is also the widest authorable duration. */
const maximumDurationMilliseconds = 86_400_000;

export type DurableDuration = `${number}${DurationUnit}`;

function durationMilliseconds(value: unknown, label: string): number {
	if (typeof value !== "string")
		throw new TypeError(`durable ${label} must be a duration string`);
	const match = /^([1-9][0-9]{0,8})(ms|s|m|h|d)$/.exec(value);
	if (!match)
		throw new TypeError(
			`durable ${label} must be a positive duration such as "1s"`,
		);
	const milliseconds =
		Number(match[1]) * unitMilliseconds[match[2] as DurationUnit];
	if (milliseconds > maximumDurationMilliseconds)
		throw new TypeError(
			`durable ${label} exceeds the accepted ${maximumDurationMilliseconds} ms bound`,
		);
	return milliseconds;
}

export interface DurableRunAsDefinition {
	readonly kind: "durableRunAs";
	readonly actor: "caller";
	readonly whenDenied: "fail";
}

export interface DurableRetryDefinition {
	readonly kind: "durableRetry";
	readonly maximumAttempts: number;
	readonly initialDelayMilliseconds: number;
	readonly backoff: "exponential";
	readonly maximumDelayMilliseconds: number;
	readonly jitter: "full";
	readonly horizonMilliseconds: number;
}

/**
 * The accepted Reaction retry program bounds: at most eight attempts, a
 * 900,000 ms backoff cap, and a 86,400,000 ms horizon.
 */
const maximumAttemptCount = 8;
const maximumBackoffMilliseconds = 900_000;

export const durable = Object.freeze({
	caller: (input: Readonly<{ whenDenied: "fail" }>): DurableRunAsDefinition => {
		if (input.whenDenied !== "fail")
			throw new TypeError('durable.caller whenDenied must be "fail"');
		return Object.freeze({
			kind: "durableRunAs" as const,
			actor: "caller" as const,
			whenDenied: "fail" as const,
		});
	},
	retry: (
		input: Readonly<{
			maximumAttempts: number;
			initialDelay: DurableDuration;
			backoff: "exponential";
			maximumDelay: DurableDuration;
			jitter: "full";
			horizon: DurableDuration;
		}>,
	): DurableRetryDefinition => {
		if (
			!Number.isSafeInteger(input.maximumAttempts) ||
			input.maximumAttempts < 1 ||
			input.maximumAttempts > maximumAttemptCount
		)
			throw new TypeError(
				`durable.retry maximumAttempts must be between 1 and ${maximumAttemptCount}`,
			);
		if (input.backoff !== "exponential")
			throw new TypeError('durable.retry backoff must be "exponential"');
		if (input.jitter !== "full")
			throw new TypeError('durable.retry jitter must be "full"');
		const initialDelayMilliseconds = durationMilliseconds(
			input.initialDelay,
			"retry initialDelay",
		);
		const maximumDelayMilliseconds = durationMilliseconds(
			input.maximumDelay,
			"retry maximumDelay",
		);
		const horizonMilliseconds = durationMilliseconds(
			input.horizon,
			"retry horizon",
		);
		if (maximumDelayMilliseconds > maximumBackoffMilliseconds)
			throw new TypeError(
				`durable.retry maximumDelay exceeds the accepted ${maximumBackoffMilliseconds} ms cap`,
			);
		if (maximumDelayMilliseconds < initialDelayMilliseconds)
			throw new TypeError(
				"durable.retry maximumDelay must not be shorter than initialDelay",
			);
		if (horizonMilliseconds < maximumDelayMilliseconds)
			throw new TypeError(
				"durable.retry horizon must not be shorter than maximumDelay",
			);
		return Object.freeze({
			kind: "durableRetry" as const,
			maximumAttempts: input.maximumAttempts,
			initialDelayMilliseconds,
			backoff: "exponential" as const,
			maximumDelayMilliseconds,
			jitter: "full" as const,
			horizonMilliseconds,
		});
	},
});
