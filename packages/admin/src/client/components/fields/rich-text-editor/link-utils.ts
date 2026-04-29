const URL_PROTOCOL_RE = /^[a-z][a-z\d+\-.]*:/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOST_LIKE_RE = /^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i;

export function normalizeLinkHref(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return "";

	if (
		URL_PROTOCOL_RE.test(trimmed) ||
		trimmed.startsWith("/") ||
		trimmed.startsWith("#")
	) {
		return trimmed;
	}

	if (EMAIL_RE.test(trimmed)) {
		return `mailto:${trimmed}`;
	}

	return `https://${trimmed}`;
}

export function isLikelyLinkHref(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed || /\s/.test(trimmed)) return false;

	return (
		URL_PROTOCOL_RE.test(trimmed) ||
		trimmed.startsWith("/") ||
		trimmed.startsWith("#") ||
		EMAIL_RE.test(trimmed) ||
		HOST_LIKE_RE.test(trimmed)
	);
}

export function createLinkAttributes(value: string) {
	const href = normalizeLinkHref(value);
	return {
		href,
		rel: "noopener noreferrer",
		target: "_blank",
	};
}
