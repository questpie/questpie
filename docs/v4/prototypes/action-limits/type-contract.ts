import type { ActionLimits } from "./contract";

const limits = {
	inputBytes: 64,
	resultBytes: 32,
	durationMilliseconds: 5_000,
} as const satisfies ActionLimits;

void limits.inputBytes;
void limits.resultBytes;
void limits.durationMilliseconds;

// @ts-expect-error Action has no Route transport body limit.
void (limits satisfies ActionLimits).bodyBytes;
// @ts-expect-error Action has no Runtime request framing limit.
void (limits satisfies ActionLimits).requestBytes;
// @ts-expect-error The accepted duration unit is explicit milliseconds.
void (limits satisfies ActionLimits).durationMs;

// @ts-expect-error Every Action limit is explicit; no partial/defaulted map.
const missing: ActionLimits = { inputBytes: 64, resultBytes: 32 };
void missing;

// @ts-expect-error The Action limit contract does not admit transport aliases.
const routeLimits: ActionLimits = { bodyBytes: 64, durationMs: 5_000 };
void routeLimits;
