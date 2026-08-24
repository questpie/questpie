import { expect, test } from "bun:test";

import {
	CanonicalJsonError,
	canonicalJsonLine,
} from "../../packages/runtime/src/canonical-json";

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
