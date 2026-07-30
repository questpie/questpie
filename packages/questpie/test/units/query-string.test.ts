import { describe, expect, it } from "bun:test";

import qs from "qs";

import { stringifyQuery } from "../../src/shared/query-string.js";

/**
 * Differential test against `qs` itself.
 *
 * The point of `stringifyQuery` is to drop ~47 KB from the client bundle
 * WITHOUT changing the wire format, so asserting against hand-written expected
 * strings would only prove that I wrote the same thing twice. Every case here
 * compares byte-for-byte with the library being replaced, under the exact
 * options every client call site uses.
 */
const QS_OPTIONS = { skipNulls: true, arrayFormat: "brackets" } as const;

const same = (input: Record<string, unknown>) => {
	expect(stringifyQuery(input)).toBe(qs.stringify(input, QS_OPTIONS));
};

describe("stringifyQuery", () => {
	it("matches qs for scalars", () => {
		same({ a: 1, b: "x y", c: true, d: false, e: 0, f: "" });
	});

	it("skips null and undefined but keeps falsy scalars", () => {
		same({ a: null, b: undefined, c: 0, d: "", e: false });
	});

	it("matches qs for arrays in brackets format", () => {
		same({ arr: [1, 2, 3] });
		same({ arr: ["a", "b"] });
		same({ arr: [] });
		same({ mixed: [1, "two", true] });
	});

	it("matches qs for nested objects", () => {
		same({ nested: { a: 1, b: { c: 2 } } });
		same({ where: { title: { eq: "hi" }, n: { gt: 3 } } });
		same({ emptyObj: {} });
		same({ a: { b: {} } });
	});

	it("matches qs for arrays of objects", () => {
		// Brackets format repeats `key[]` with no index, so both elements share
		// a key — this is the shape most likely to drift from a naive encoder.
		same({ objs: [{ a: 1 }, { a: 2 }] });
		same({ objs: [{ a: { b: 1 } }] });
	});

	it("matches qs for arrays nested inside objects", () => {
		same({ deep: { arr: [1, 2], o: { x: null, y: 1 } } });
	});

	it("matches qs for Date values", () => {
		same({ d: new Date("2020-01-02T03:04:05.000Z") });
		same({ nested: { at: new Date(0) } });
	});

	it("matches qs percent-encoding, including RFC3986 extras", () => {
		// encodeURIComponent leaves !'()* alone; qs escapes them. Getting this
		// wrong would produce a subtly different string that still "works".
		same({ s: "a!b'c(d)e*f~g-h_i.j" });
		same({ "k[weird]": "v", "a&b": "c=d" });
		same({ unicode: "ä ř 😀" });
		same({ "?q": "a+b/c:d@e" });
	});

	it("matches qs for the real client query shapes", () => {
		same({
			where: { status: { eq: "published" }, views: { gte: 100 } },
			limit: 20,
			offset: 0,
			sort: ["-createdAt", "title"],
			locale: "en",
			depth: null,
		});
		same({
			select: { title: true, author: { name: true } },
			populate: ["author", "tags"],
		});
	});

	it("returns an empty string when everything is skipped", () => {
		expect(stringifyQuery({})).toBe("");
		expect(stringifyQuery({ a: null, b: undefined })).toBe("");
		expect(stringifyQuery({ a: [], b: {} })).toBe("");
	});

	it("round-trips through the parser the server actually uses", () => {
		// The encoder only matters if `qs.parse` on the server reads it back to
		// the same value — matching qs.stringify byte-for-byte implies this,
		// but assert it directly for the shapes that carry query semantics.
		const input = {
			where: { title: { contains: "a b" }, n: { gt: 3 } },
			sort: ["-createdAt"],
			limit: 10,
		};
		const parsed = qs.parse(stringifyQuery(input), {
			allowDots: true,
			comma: true,
		});
		expect(parsed).toEqual({
			where: { title: { contains: "a b" }, n: { gt: "3" } },
			sort: ["-createdAt"],
			limit: "10",
		});
	});
});
