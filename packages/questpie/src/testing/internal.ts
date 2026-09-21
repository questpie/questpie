/**
 * Pure helpers for `questpie/testing`, split out so this repository's own
 * white-box unit tests can import them directly by relative path. This file
 * is not reachable through any published `questpie` export subpath —
 * `package.json#exports` only maps `./testing` to `./testing/index.js`, not
 * `./testing/internal.js` — so nothing here is part of the public surface
 * ADR-0045 governs; only `index.ts`'s re-exports are.
 */

export function quoteIdentifier(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

/**
 * PostgreSQL truncates identifiers longer than 63 bytes (`NAMEDATALEN - 1`)
 * silently instead of rejecting them: a `CREATE DATABASE` for a 70-byte name
 * succeeds but actually creates a 63-byte one, so every later connection
 * using the full name this module generated fails with "database does not
 * exist". This limit is enforced explicitly instead.
 */
export const POSTGRES_MAX_IDENTIFIER_BYTES = 63;

/** Conservative, quoting-safe charset; also required for reaper name parsing. */
export const NAME_PREFIX_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/;

export function validateNamePrefix(namePrefix: string): void {
	if (!NAME_PREFIX_PATTERN.test(namePrefix))
		throw new TypeError(
			`questpie/testing: namePrefix ${JSON.stringify(namePrefix)} must match ${String(NAME_PREFIX_PATTERN)} (letters, digits, underscore; starts with a letter; at most 41 characters)`,
		);
}

/**
 * `<prefix>_<createdAt base36>_<16 lowercase hex>`. The embedded creation
 * timestamp lets `reapTestDatabases` find and drop this module's own leaked
 * databases without PostgreSQL storing a database creation timestamp
 * anywhere itself.
 */
export function buildDatabaseName(namePrefix: string): string {
	validateNamePrefix(namePrefix);
	const createdAt = Date.now().toString(36);
	const random = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
	const name = `${namePrefix}_${createdAt}_${random}`;
	const byteLength = Buffer.byteLength(name, "utf8");
	if (byteLength > POSTGRES_MAX_IDENTIFIER_BYTES)
		throw new TypeError(
			`questpie/testing: generated database name ${JSON.stringify(name)} is ${byteLength} bytes, exceeding PostgreSQL's ${POSTGRES_MAX_IDENTIFIER_BYTES}-byte identifier limit; use a shorter namePrefix`,
		);
	return name;
}

export function parseDatabaseName(
	namePrefix: string,
	databaseName: string,
): Readonly<{ createdAtMs: number }> | null {
	const escapedPrefix = namePrefix.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(`^${escapedPrefix}_([0-9a-z]+)_[0-9a-f]{16}$`).exec(
		databaseName,
	);
	if (!match) return null;
	const createdAtMs = Number.parseInt(match[1]!, 36);
	return Number.isFinite(createdAtMs) ? Object.freeze({ createdAtMs }) : null;
}

/**
 * Replaces the credential component of any `postgres://`/`postgresql://`
 * URL found in `text` with `***`. Applied to CLI output folded into thrown
 * errors and to reaper failure records so a connection string's password
 * never reaches a log or an assertion message.
 */
export function redactPostgresCredentials(text: string): string {
	return text.replaceAll(
		/(postgres(?:ql)?:\/\/[^:/?#@\s]+):([^@/?#\s]*)@/gi,
		"$1:***@",
	);
}

export function connectionUrlForDatabase(
	adminConnectionUrl: string,
	databaseName: string,
): string {
	const url = new URL(adminConnectionUrl);
	url.pathname = `/${databaseName}`;
	return url.toString();
}

/**
 * Environment variables `buildCliEnvironment` inherits from `source` by
 * default. Deliberately small: a spawned CLI needs enough to find its own
 * runtime (`PATH`), a home directory for tool caches, and a disk-backed temp
 * directory, not the calling process's full (possibly credential-bearing)
 * environment.
 */
export const INHERITED_ENV_ALLOWLIST = [
	"PATH",
	"HOME",
	"TMPDIR",
	"TEMP",
	"TMP",
] as const;

/**
 * Builds the environment for a spawned `questpie` CLI invocation:
 * `INHERITED_ENV_ALLOWLIST` entries from `source`, then `overrides`, then
 * `DATABASE_URL` (when `connectionUrl` is given) — never `source` in full.
 * Pure and side-effect-free so it can be unit-tested without spawning a
 * process.
 */
export function buildCliEnvironment(
	input: Readonly<{
		source: Readonly<Record<string, string | undefined>>;
		overrides?: Readonly<Record<string, string>>;
		connectionUrl?: string;
	}>,
): Record<string, string> {
	const environment: Record<string, string> = {};
	for (const name of INHERITED_ENV_ALLOWLIST) {
		const value = input.source[name];
		if (value !== undefined) environment[name] = value;
	}
	Object.assign(environment, input.overrides);
	if (input.connectionUrl !== undefined)
		environment.DATABASE_URL = input.connectionUrl;
	return environment;
}
