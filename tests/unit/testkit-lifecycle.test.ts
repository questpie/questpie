import { expect, test } from "bun:test";

import { CleanupStack, eventually } from "../../packages/testkit/src";

test("cleanup is idempotent, LIFO, and does not hide sibling failures", async () => {
	const stack = new CleanupStack();
	const calls: string[] = [];
	stack.defer(() => calls.push("first"));
	stack.defer(() => {
		calls.push("second");
		throw new Error("second failed");
	});
	stack.defer(() => calls.push("third"));
	await expect(stack.dispose()).rejects.toBeInstanceOf(AggregateError);
	expect(calls).toEqual(["third", "second", "first"]);
	await stack.dispose();
	expect(calls).toEqual(["third", "second", "first"]);
});

test("eventually returns the accepted observation", async () => {
	let attempts = 0;
	const value = await eventually(() => ++attempts, {
		accept: (candidate) => candidate === 3,
		intervalMilliseconds: 1,
		timeoutMilliseconds: 100,
	});
	expect(value).toBe(3);
});
