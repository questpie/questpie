import { describe, expect, test } from "bun:test";

import { canonicalArtifactBytes } from "@questpie/compiler";

describe("BETA-02 canonical artifact bytes", () => {
	test("preserves legacy object enumeration for integer-like keys", () => {
		expect(
			canonicalArtifactBytes({ "2": "two", "10": "ten", a: "letter" }),
		).toBe('{"2":"two","10":"ten","a":"letter"}\n');
	});

	test("preserves legacy enumeration inside tagged open JSON", () => {
		expect(
			canonicalArtifactBytes({
				kind: "json",
				value: { nested: { "2": "two", "10": "ten", a: "letter" } },
			}),
		).toBe(
			'{"kind":"json","value":{"nested":{"2":"two","10":"ten","a":"letter"}}}\n',
		);
	});

	test("distinguishes array-index keys from neighboring spellings", () => {
		expect(
			canonicalArtifactBytes({
				"0": "zero",
				"00": "double-zero",
				"01": "leading-zero",
				"4294967294": "last-index",
				"4294967295": "past-index",
				a: "letter",
			}),
		).toBe(
			'{"0":"zero","4294967294":"last-index","00":"double-zero","01":"leading-zero","4294967295":"past-index","a":"letter"}\n',
		);
	});
});
