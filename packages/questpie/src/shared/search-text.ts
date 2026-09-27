/** Versioned normalization for indexes and queries; source text remains untouched. */
export const SEARCH_TEXT_NORMALIZATION = "nfkd-case-marks-v1";

export function normalizeSearchText(text: string): string {
	return text
		.normalize("NFKD")
		.toLowerCase()
		.replace(/\p{M}+/gu, "")
		.replace(/\s+/gu, " ")
		.trim();
}

/** UTF-16 offsets address the original graphemes, including decomposed marks. */
export function searchTextMatchRanges(text: string, terms: readonly string[]) {
	const offsets: { start: number; end: number }[] = [];
	let folded = "";
	for (const part of new Intl.Segmenter(undefined, {
		granularity: "grapheme",
	}).segment(text)) {
		const value = normalizeSearchText(part.segment);
		// Preserve separators rather than collapsing words during per-grapheme folding.
		const normalized = value || (/\s/u.test(part.segment) ? " " : "");
		if (normalized === " " && folded.endsWith(" ")) {
			offsets[offsets.length - 1]!.end = part.index + part.segment.length;
			continue;
		}
		folded += normalized;
		for (let i = 0; i < normalized.length; i++)
			offsets.push({
				start: part.index,
				end: part.index + part.segment.length,
			});
	}
	const ranges: { start: number; end: number }[] = [];
	for (const term of new Set(terms.map(normalizeSearchText).filter(Boolean))) {
		let from = 0;
		while (from < folded.length) {
			const index = folded.indexOf(term, from);
			if (index < 0) break;
			ranges.push({
				start: offsets[index]!.start,
				end: offsets[index + term.length - 1]!.end,
			});
			from = index + term.length;
		}
	}
	return ranges;
}
