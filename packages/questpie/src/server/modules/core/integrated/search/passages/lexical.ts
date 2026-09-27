import { normalizeSearchText } from "#questpie/shared/search-text.js";

export function passageTerms(query: string): string[] {
	return (
		normalizeSearchText(query)
			.match(/[\p{L}\p{N}_]+/gu)
			?.slice(0, 32) ?? []
	);
}

/** Conservative fallback: one adjacent transposition or one extra typed letter, title-only. */
export function passageTypoQuery(
	query: string,
	terms: string[],
): string | null {
	if (
		terms.length > 4 ||
		terms.some((term) => /\p{N}/u.test(term)) ||
		/^[\p{L}\p{N}_]+-\d+$/u.test(query.trim()) ||
		/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(query.trim())
	)
		return null;
	const groups = terms.flatMap((term, termIndex) => {
		const letters = [...term];
		const variants = new Set([term]);
		if (/^\p{L}+$/u.test(term) && letters.length >= 5 && letters.length <= 24) {
			for (let i = 0; i < letters.length; i++) {
				variants.add(letters.filter((_, index) => index !== i).join(""));
				if (i + 1 < letters.length) {
					const swapped = [...letters];
					[swapped[i], swapped[i + 1]] = [swapped[i + 1]!, swapped[i]!];
					variants.add(swapped.join(""));
				}
			}
		}
		variants.delete(term);
		if (!variants.size) return [];
		return [
			`(${terms
				.map((value, index) =>
					index === termIndex
						? `(${[...variants].map((variant) => `${variant}:*`).join(" | ")})`
						: `${value}:*`,
				)
				.join(" & ")})`,
		];
	});
	return groups.length ? groups.join(" | ") : null;
}
