import { expect, test } from "bun:test";

import {
	normalizeSearchText,
	searchTextMatchRanges,
} from "../../src/shared/search-text.js";

test("search ranges address original UTF-16 graphemes after normalization", () => {
	const text = "😀 Z\u030clta\u0301   zmluva ﬃ";
	expect(normalizeSearchText(text)).toBe("😀 zlta zmluva ffi");
	const ranges = searchTextMatchRanges(text, ["ŽLTÁ ZMLUVA", "ffi"]);
	expect(ranges.map(({ start, end }) => text.slice(start, end))).toEqual([
		"Z\u030clta\u0301   zmluva",
		"ﬃ",
	]);
	expect(
		searchTextMatchRanges("áá áá", ["aa", "AA"]).map(({ start, end }) => [
			start,
			end,
		]),
	).toEqual([
		[0, 2],
		[3, 5],
	]);
});
