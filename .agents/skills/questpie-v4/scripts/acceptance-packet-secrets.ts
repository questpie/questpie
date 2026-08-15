export type AcceptancePacketSecret = {
	name:
		| "database URL"
		| "credential assignment"
		| "private key"
		| "GitHub token"
		| "AWS access key"
		| "generic credential";
};

const DATABASE_URL =
	/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"'<>`]+/giu;
const PASSWORD_PROPERTY_ASSIGNMENT =
	/\b[A-Za-z_$][\w$]*(?:\.password|\[\s*["']password["']\s*\])\s*=(?!=)/iu;
const SAFE_PASSWORD_FORWARDING =
	/\burl(?:\.password|\[\s*["']password["']\s*\])\s*=\s*process\.env\.PGPASSWORD\b(?!\s*(?:\|\||\?\?|&&))/giu;
const SAFE_PASSWORD_PLACEHOLDER = /\burl\.password\s*=\s*\.\.\./giu;
const NEGATIVE_CONTROL_PATH = "tests/unit/acceptance-packet-secrets.test.ts";
const NEGATIVE_CONTROL_MARKER = "acceptance-secret-negative-control";
const SECRET_PATTERNS: Array<[AcceptancePacketSecret["name"], RegExp]> = [
	["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
	["GitHub token", /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/],
	["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
	[
		"generic credential",
		/\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[^\s"']{8,}/i,
	],
];

type Range = { start: number; end: number };

function isSafeLocalPostgresUrl(value: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return false;
	}
	return (
		(parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") &&
		parsed.hostname === "localhost" &&
		parsed.username === "" &&
		parsed.password === "" &&
		parsed.search === "" &&
		parsed.hash === "" &&
		/^\/[A-Za-z0-9_-]*$/.test(parsed.pathname)
	);
}

function maskRanges(value: string, ranges: Range[]): string {
	const characters = value.split("");
	for (const range of ranges) {
		for (let index = range.start; index < range.end; index += 1) {
			characters[index] = " ";
		}
	}
	return characters.join("");
}

/**
 * Finds secret-bearing packet text while permitting exactly two source forms:
 * credential-free PostgreSQL localhost literals and forwarding from PGPASSWORD
 * into the `url` password property. These are source/configuration
 * descriptions, not credential values. Alternate environment variables,
 * fallback values, embedded URL credentials, remote hosts, queries, fragments,
 * and every other database URL remain prohibited.
 */
export function findAcceptancePacketSecret(
	packet: string,
): AcceptancePacketSecret | null {
	const allowed: Range[] = [];

	for (const match of packet.matchAll(DATABASE_URL)) {
		if (!isSafeLocalPostgresUrl(match[0])) return { name: "database URL" };
		allowed.push({ start: match.index, end: match.index + match[0].length });
	}

	for (const pattern of [SAFE_PASSWORD_FORWARDING, SAFE_PASSWORD_PLACEHOLDER]) {
		for (const match of packet.matchAll(pattern)) {
			allowed.push({ start: match.index, end: match.index + match[0].length });
		}
	}

	const remaining = maskRanges(packet, allowed);
	if (PASSWORD_PROPERTY_ASSIGNMENT.test(remaining)) {
		return { name: "credential assignment" };
	}
	for (const [name, pattern] of SECRET_PATTERNS) {
		if (pattern.test(remaining)) return { name };
	}
	return null;
}

/**
 * Scans exact git-diff bytes while masking only explicitly marked synthetic
 * probes in the one scanner negative-control file. The same marker in any
 * other path, or an unmarked credential in the fixture itself, remains fatal.
 */
export function findAcceptanceGitDiffSecret(
	diff: string,
): AcceptancePacketSecret | null {
	let currentPath = "";
	const sanitized = diff
		.split("\n")
		.map((line) => {
			const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
			if (header) currentPath = header[2];
			if (
				currentPath === NEGATIVE_CONTROL_PATH &&
				/^[+-](?![+-])/.test(line) &&
				line.includes(NEGATIVE_CONTROL_MARKER)
			) {
				return `${line[0]}// ${NEGATIVE_CONTROL_MARKER}`;
			}
			return line;
		})
		.join("\n");
	return findAcceptancePacketSecret(sanitized);
}
