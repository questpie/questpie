import { parseAcceptanceDiffLines } from "./acceptance-diff-lines";
import { findDatabaseUrlTokens } from "./acceptance-packet-secrets";

export type HistoricalDatabaseUrlRedaction = {
	path: string;
	baseLine: number;
};

export class HistoricalRedactionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "HistoricalRedactionError";
	}
}

function invalid(message: string): never {
	throw new HistoricalRedactionError(message);
}

export function decodeHistoricalRedactions(
	value: unknown,
): HistoricalDatabaseUrlRedaction[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > 8)
		invalid("historical redactions require one through eight locations");
	const seen = new Set<string>();
	return value.map((entry: unknown) => {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry))
			invalid("historical redaction has an invalid shape");
		const keys = Object.keys(entry).sort();
		const { path, baseLine } = entry as Record<string, unknown>;
		if (
			keys.length !== 2 ||
			keys[0] !== "baseLine" ||
			keys[1] !== "path" ||
			typeof path !== "string" ||
			!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u.test(path) ||
			path.split("/").some((part) => part === "." || part === "..") ||
			typeof baseLine !== "number" ||
			!Number.isSafeInteger(baseLine) ||
			baseLine < 1
		)
			invalid("historical redaction requires an exact safe path and base line");
		const key = `${path}:${baseLine}`;
		if (seen.has(key)) invalid("duplicate historical redaction location");
		seen.add(key);
		return { path, baseLine };
	});
}

export function redactHistoricalDatabaseUrls(input: {
	diff: string;
	entries: readonly HistoricalDatabaseUrlRedaction[];
	readBase: (path: string) => string;
	presentAtHead: (value: string) => boolean;
}) {
	const applied = new Set<number>();
	const bases = new Map<string, string[]>();
	const diff = parseAcceptanceDiffLines(input.diff)
		.map((line) => {
			const index = input.entries.findIndex(
				(entry) => entry.path === line.path && entry.baseLine === line.oldLine,
			);
			if (index === -1) return line.text;
			const entry = input.entries[index]!;
			if (line.kind !== "removed" || applied.has(index))
				invalid("historical redaction must target one removed base line");
			let base = bases.get(entry.path);
			if (!base) {
				base = input.readBase(entry.path).split("\n");
				bases.set(entry.path, base);
			}
			const original = base[entry.baseLine - 1];
			if (original === undefined || line.text !== `-${original}`)
				invalid("historical redaction does not match its committed base line");
			const tokens = findDatabaseUrlTokens(original);
			if (tokens.length !== 1)
				invalid("historical redaction requires exactly one database URL token");
			const token = tokens[0]!;
			let url: URL;
			try {
				url = new URL(token.value);
			} catch {
				invalid("historical redaction URL is malformed");
			}
			if (!url.username && !url.password)
				invalid(
					"historical redaction requires credential-bearing URL material",
				);
			if (input.presentAtHead(token.value))
				invalid("historical redaction URL remains in reviewed head content");
			applied.add(index);
			return `-${original.slice(0, token.index)}REDACTED_HISTORICAL_DATABASE_URL_${index + 1}${original.slice(token.index + token.value.length)}`;
		})
		.join("\n");
	if (applied.size !== input.entries.length)
		invalid("historical redaction location is absent from removed diff lines");
	return {
		diff,
		locations: input.entries.map((entry, index) => ({
			index: index + 1,
			...entry,
		})),
	};
}
