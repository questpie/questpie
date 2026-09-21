import { expect, test } from "bun:test";

import { createTestDatabase } from "../../packages/questpie/src/testing/index";
import {
	buildCliEnvironment,
	buildDatabaseName,
	connectionUrlForDatabase,
	parseDatabaseName,
	redactPostgresCredentials,
	validateNamePrefix,
} from "../../packages/questpie/src/testing/internal";

test("validateNamePrefix rejects empty, non-letter-leading, and unsafe-character prefixes", () => {
	expect(() => validateNamePrefix("")).toThrow(TypeError);
	expect(() => validateNamePrefix("1abc")).toThrow(TypeError);
	expect(() => validateNamePrefix("abc-def")).toThrow(TypeError);
	expect(() => validateNamePrefix("abc def")).toThrow(TypeError);
	expect(() => validateNamePrefix('abc"; DROP DATABASE postgres; --')).toThrow(
		TypeError,
	);
	expect(() => validateNamePrefix("valid_prefix")).not.toThrow();
});

test("buildDatabaseName rejects a prefix whose generated name would exceed 63 bytes", () => {
	// 41 is the longest namePrefix validateNamePrefix accepts; the "_<base36
	// timestamp>_<16 hex>" suffix pushes the full name well past 63 bytes.
	const longestAccepted = `a${"b".repeat(40)}`;
	expect(longestAccepted).toHaveLength(41);
	expect(() => buildDatabaseName(longestAccepted)).toThrow(
		/exceeding PostgreSQL's 63-byte identifier limit/,
	);
});

test("createTestDatabase rejects an oversized namePrefix before opening any connection", async () => {
	// adminConnectionUrl deliberately points at a port nothing listens on: if
	// this resolved, it would hang or fail with a connection error instead of
	// the synchronous validation error asserted below.
	await expect(
		createTestDatabase({
			adminConnectionUrl: "postgres://postgres@127.0.0.1:1/postgres",
			namePrefix: `a${"b".repeat(40)}`,
		}),
	).rejects.toThrow(/exceeding PostgreSQL's 63-byte identifier limit/);
});

test("createTestDatabase rejects an unsafe namePrefix before opening any connection", async () => {
	await expect(
		createTestDatabase({
			adminConnectionUrl: "postgres://postgres@127.0.0.1:1/postgres",
			namePrefix: "not a safe prefix",
		}),
	).rejects.toThrow(TypeError);
});

test("buildDatabaseName output round-trips through parseDatabaseName", () => {
	const before = Date.now();
	const name = buildDatabaseName("questpie_reaper_probe");
	const after = Date.now();
	const parsed = parseDatabaseName("questpie_reaper_probe", name);
	expect(parsed).not.toBeNull();
	expect(parsed!.createdAtMs).toBeGreaterThanOrEqual(before);
	expect(parsed!.createdAtMs).toBeLessThanOrEqual(after);
});

test("parseDatabaseName returns null for a name from a different prefix or shape", () => {
	const name = buildDatabaseName("questpie_reaper_probe");
	expect(parseDatabaseName("some_other_prefix", name)).toBeNull();
	expect(
		parseDatabaseName("questpie_reaper_probe", "not_a_generated_name"),
	).toBeNull();
	expect(parseDatabaseName("questpie_reaper_probe", "")).toBeNull();
});

test("parseDatabaseName treats a regex-special prefix literally, not as a pattern", () => {
	// A prefix containing regex metacharacters must not let an unrelated
	// database name match through pattern injection.
	const evilPrefix = "a.b";
	expect(validateNamePrefix.bind(null, evilPrefix)).toThrow(TypeError);
});

test("redactPostgresCredentials strips the password from postgres:// and postgresql:// URLs", () => {
	expect(
		redactPostgresCredentials(
			"connection failed: postgres://appuser:s3cr3t-p4ss@db.internal:5432/appdb is unreachable",
		),
	).toBe(
		"connection failed: postgres://appuser:***@db.internal:5432/appdb is unreachable",
	);
	expect(
		redactPostgresCredentials(
			"retry postgresql://admin:another$ecret@127.0.0.1/postgres now",
		),
	).toBe("retry postgresql://admin:***@127.0.0.1/postgres now");
});

test("redactPostgresCredentials redacts every occurrence, including repeats and no-password URLs", () => {
	const text =
		"first postgres://a:b@h1/db1 then postgres://a:b@h1/db1 again and postgres://nobody@h2/db2 bare";
	const redacted = redactPostgresCredentials(text);
	expect(redacted).not.toContain(":b@");
	expect(redacted.match(/:\*\*\*@/g)).toHaveLength(2);
	// A URL with no password component (no ":" before "@") is left as-is;
	// there is no credential to redact.
	expect(redacted).toContain("postgres://nobody@h2/db2");
});

test("redactPostgresCredentials leaves text without a connection string unchanged", () => {
	const text = "questpie migration apply failed with exit code 1";
	expect(redactPostgresCredentials(text)).toBe(text);
});

test("buildCliEnvironment never leaks the source environment beyond the allowlist", () => {
	const environment = buildCliEnvironment({
		source: {
			PATH: "/usr/bin",
			HOME: "/home/tester",
			AWS_SECRET_ACCESS_KEY: "super-secret-leak-me-not",
			DATABASE_PASSWORD: "another-secret",
			CI_TOKEN: "yet-another-secret",
		},
	});
	expect(environment).toEqual({ PATH: "/usr/bin", HOME: "/home/tester" });
	expect(environment).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
	expect(environment).not.toHaveProperty("DATABASE_PASSWORD");
	expect(environment).not.toHaveProperty("CI_TOKEN");
});

test("buildCliEnvironment applies explicit overrides and DATABASE_URL on top of the allowlist", () => {
	const environment = buildCliEnvironment({
		source: { PATH: "/usr/bin", SECRET: "leak" },
		overrides: { QUESTPIE_REALTIME_HMAC_KEY: "11".repeat(32) },
		connectionUrl: "postgres://user:pass@127.0.0.1/db",
	});
	expect(environment).toEqual({
		PATH: "/usr/bin",
		QUESTPIE_REALTIME_HMAC_KEY: "11".repeat(32),
		DATABASE_URL: "postgres://user:pass@127.0.0.1/db",
	});
});

test("connectionUrlForDatabase replaces only the path, preserving credentials and host", () => {
	const url = connectionUrlForDatabase(
		"postgres://appuser:s3cr3t@127.0.0.1:5432/postgres",
		"questpie_test_abc123",
	);
	expect(url).toBe(
		"postgres://appuser:s3cr3t@127.0.0.1:5432/questpie_test_abc123",
	);
});
