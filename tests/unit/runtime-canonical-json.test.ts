import { expect, test } from "bun:test";

import {
	CanonicalJsonError,
	canonicalJsonLine,
} from "../../packages/runtime/src/canonical-json";
import {
	canonicalMutationBytes,
	deterministicUuid,
	mutationDigest,
} from "../../packages/runtime/src/mutation/contract";

test("Runtime canonical JSON rejects every lone Unicode surrogate", () => {
	for (const value of ["\ud800", "\udbff", "\udc00", "\udfff"]) {
		expect(() => canonicalJsonLine(value)).toThrow(CanonicalJsonError);
		expect(() => canonicalJsonLine({ [value]: true })).toThrow(
			CanonicalJsonError,
		);
	}
	expect(new TextDecoder().decode(canonicalJsonLine("\ud83d\ude80"))).toBe(
		'"🚀"\n',
	);
});

test("Mutation contract preserves canonical bytes and deterministic identities", () => {
	expect(
		new TextDecoder().decode(
			canonicalMutationBytes({
				"2": "two",
				"10": "ten",
				nested: [true, null, "🚀"],
			}),
		),
	).toBe('{"10":"ten","2":"two","nested":[true,null,"🚀"]}\n');
	const empty = new Uint8Array();
	expect(mutationDigest(empty)).toBe(
		"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
	);
	expect(deterministicUuid(empty)).toBe("e3b0c442-98fc-5c14-aafb-f4c8996fb924");
});

test("Mutation contract retains its TypeError mapping and canonical error cause", () => {
	const cycle: unknown[] = [];
	cycle.push(cycle);
	for (const [value, reason, message] of [
		[NaN, "invalid-number", "Mutation canonical JSON rejects this number"],
		[-0, "invalid-number", "Mutation canonical JSON rejects this number"],
		[Infinity, "invalid-number", "Mutation canonical JSON rejects this number"],
		[
			"\ud800",
			"invalid-unicode",
			"Mutation canonical JSON rejects lone surrogates",
		],
		[
			{ "\udfff": true },
			"invalid-unicode",
			"Mutation canonical JSON rejects lone surrogates",
		],
		[undefined, "invalid-value", "Mutation canonical JSON rejects this value"],
		[cycle, "cycle", "Mutation canonical JSON rejects this value"],
	] as const) {
		let failure: unknown;
		try {
			canonicalMutationBytes(value);
		} catch (error) {
			failure = error;
		}
		expect(failure?.constructor).toBe(TypeError);
		expect(failure).toMatchObject({ message, cause: { reason } });
		expect((failure as Error).cause).toBeInstanceOf(CanonicalJsonError);
	}
	const failure = new Error("caller-owned getter failure");
	expect(() =>
		canonicalMutationBytes({
			get value() {
				throw failure;
			},
		}),
	).toThrow(failure);
});
