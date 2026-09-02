import { expect, test } from "bun:test";

import {
	canonicalOperationFailures,
	operationFailureStatus,
} from "../../packages/runtime/src/operation";

test("one canonical ordinary failure catalogue owns HTTP status and retryability", () => {
	expect(canonicalOperationFailures).toEqual({
		DEADLINE_EXCEEDED: { retryable: true, status: 408 },
		INTERNAL: { retryable: false, status: 500 },
		NOT_FOUND: { retryable: false, status: 404 },
		PROTOCOL_UNSUPPORTED: { retryable: false, status: 400 },
		RESOURCE_LIMIT: { retryable: true, status: 429 },
		RUNTIME_UNAVAILABLE: { retryable: true, status: 503 },
		UNAUTHENTICATED: { retryable: false, status: 401 },
	});
	expect(operationFailureStatus("UNAUTHENTICATED")).toBe(401);
	expect(Object.isFrozen(canonicalOperationFailures)).toBe(true);
	for (const contract of Object.values(canonicalOperationFailures))
		expect(Object.isFrozen(contract)).toBe(true);
});
