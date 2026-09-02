import { expect, test } from "bun:test";

import { principal } from "questpie";

import {
	decodeRuntimeCredentialOutcome,
	RuntimeCredentialMalformed,
	RuntimeCredentialUnavailable,
} from "../../packages/runtime/src/execution/routes";

test("decodes the exact credential outcome union", () => {
	const user = principal.user({ id: "user:credential" });
	expect(decodeRuntimeCredentialOutcome({ kind: "anonymous" })).toEqual(
		principal.anonymous(),
	);
	expect(
		decodeRuntimeCredentialOutcome({ kind: "resolved", principal: user }),
	).toBe(user);
	expect(() => decodeRuntimeCredentialOutcome({ kind: "malformed" })).toThrow(
		RuntimeCredentialMalformed,
	);
	expect(() => decodeRuntimeCredentialOutcome({ kind: "unavailable" })).toThrow(
		RuntimeCredentialUnavailable,
	);
});

test("rejects malformed resolver output instead of classifying credentials", () => {
	const hiddenDetail = Object.defineProperty({ kind: "anonymous" }, "detail", {
		value: "secret",
	});
	for (const outcome of [
		null,
		[],
		{},
		{ kind: "unknown" },
		hiddenDetail,
		{ kind: "anonymous", [Symbol("detail")]: "secret" },
		{ kind: "anonymous", detail: "secret" },
		{ kind: "malformed", detail: "secret" },
		{ kind: "unavailable", detail: "secret" },
		{ kind: "resolved" },
		{ kind: "resolved", principal: { kind: "user", id: "forged" } },
		{ kind: "resolved", principal: principal.anonymous(), detail: "secret" },
	] as const)
		expect(() => decodeRuntimeCredentialOutcome(outcome)).toThrow(TypeError);
});
