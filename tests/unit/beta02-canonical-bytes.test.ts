import { describe, expect, test } from "bun:test";

import { canonicalArtifactBytes } from "@questpie/compiler";

describe("BETA-02 canonical artifact bytes", () => {
	test("orders every object key by RFC 8785 code-unit order", () => {
		expect(
			canonicalArtifactBytes({ "2": "two", "10": "ten", a: "letter" }),
		).toBe('{"10":"ten","2":"two","a":"letter"}\n');
		expect(
			canonicalArtifactBytes({
				"€": "euro",
				"\r": "carriage-return",
				"1": "one",
				"😀": "emoji",
				"\u0080": "control",
				ö: "o-umlaut",
				דּ: "presentation-form",
			}),
		).toBe(
			'{"\\r":"carriage-return","1":"one","\u0080":"control","ö":"o-umlaut","€":"euro","😀":"emoji","דּ":"presentation-form"}\n',
		);
	});

	test("keeps RFC 8785 ordering inside tagged open JSON", () => {
		expect(
			canonicalArtifactBytes({
				kind: "json",
				value: { nested: { "2": "two", "10": "ten", a: "letter" } },
			}),
		).toBe(
			'{"kind":"json","value":{"nested":{"10":"ten","2":"two","a":"letter"}}}\n',
		);
		expect(
			canonicalArtifactBytes({ values: [{ "2": "two", "10": "ten" }] }),
		).toBe('{"values":[{"10":"ten","2":"two"}]}\n');
	});

	test("does not hoist JavaScript array-index keys", () => {
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
			'{"0":"zero","00":"double-zero","01":"leading-zero","4294967294":"last-index","4294967295":"past-index","a":"letter"}\n',
		);
	});

	test("rejects lone Unicode surrogates but accepts valid pairs", () => {
		expect(() => canonicalArtifactBytes({ value: "\ud800" })).toThrow(
			/lone Unicode surrogate/,
		);
		expect(() => canonicalArtifactBytes({ nested: ["\udc00"] })).toThrow(
			/lone Unicode surrogate/,
		);
		expect(() => canonicalArtifactBytes({ "\ud800": "value" })).toThrow(
			/lone Unicode surrogate/,
		);
		expect(() =>
			canonicalArtifactBytes({ nested: { "\udc00": true } }),
		).toThrow(/lone Unicode surrogate/);
		expect(canonicalArtifactBytes({ "😀": "😀" })).toBe('{"😀":"😀"}\n');
	});
});
