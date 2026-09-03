import { expect, test } from "bun:test";

import { controlledRoot } from "../../packages/runtime/src/application/root";

test("observes an elapsed deadline even before the host timer callback runs", () => {
	let now = 0;
	const root = controlledRoot({
		deadline: 10,
		now: () => now,
	});

	try {
		expect(root.deadlineExpired).toBe(false);
		now = 10;
		expect(root.deadlineExpired).toBe(true);
	} finally {
		root.dispose();
	}
});

test("preserves an earlier caller cancellation after the deadline passes", () => {
	let now = 0;
	const caller = new AbortController();
	const root = controlledRoot({
		signal: caller.signal,
		deadline: 10,
		now: () => now,
	});

	try {
		caller.abort(new DOMException("caller cancelled", "AbortError"));
		now = 10;
		expect(root.deadlineExpired).toBe(false);
	} finally {
		root.dispose();
	}
});
