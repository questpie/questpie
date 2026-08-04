/**
 * Internal. Not exported from the package entry.
 *
 * A failing test prints what it saw, and what it saw is a production server's
 * logs or an HTTP body. Both carry the values that got it there: a database
 * password, a bearer token, a session cookie. Redaction happens on the way into
 * evidence rather than on the way out, so there is no path that renders a
 * secret by forgetting to call something.
 *
 * Longest first, because a short secret contained in a long one would otherwise
 * cut the long one in half and leave the remainder readable.
 */
export function createRedactor(
	secrets: Iterable<string>,
): (value: string) => string {
	const ordered = [...new Set(secrets)]
		.filter(Boolean)
		.sort((left, right) => right.length - left.length);
	if (ordered.length === 0) return (value) => value;
	return (value) => {
		let output = value;
		for (const secret of ordered)
			output = output.split(secret).join("[REDACTED]");
		return output;
	};
}
