import { describe, expect, test } from "bun:test";

import {
	findAcceptanceGitDiffSecret,
	findAcceptancePacketSecret,
} from "../../.agents/skills/questpie-v4/scripts/acceptance-packet-secrets";

describe("acceptance packet secret scanner", () => {
	test.each([
		'const url = new URL("postgres://localhost/");',
		'createApp({ postgres: { url: "postgres://localhost/questpie" } });',
		"if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;",
		'if (process.env.PGPASSWORD) url["password"] = process.env.PGPASSWORD;',
		"review requirement: url.password = ...",
		'živý packet — new URL("postgres://localhost/questpie"); url.password = process.env.PGPASSWORD;',
	])("permits the narrow local PostgreSQL test form: %s", (packet) => {
		expect(findAcceptancePacketSecret(packet)).toBeNull();
	});

	test.each([
		"postgres://questpie:real-secret@localhost/questpie", // acceptance-secret-negative-control
		"postgresql://questpie:real-secret@localhost/questpie", // acceptance-secret-negative-control
		"postgres://database.example.com/questpie", // acceptance-secret-negative-control
		"postgres://localhost/questpie?password=real-secret", // acceptance-secret-negative-control
		"mysql://localhost/questpie", // acceptance-secret-negative-control
	])("rejects a real or non-allowlisted database URL: %s", (packet) => {
		expect(findAcceptancePacketSecret(packet)?.name).toBe("database URL");
	});

	test.each([
		'url.password = "real-secret";', // acceptance-secret-negative-control
		"url.password = process.env.DATABASE_PASSWORD;", // acceptance-secret-negative-control
		'url.password = process.env.PGPASSWORD || "real-secret";', // acceptance-secret-negative-control
		'url["password"] = "real-secret";', // acceptance-secret-negative-control
	])("rejects a real or evasive password assignment: %s", (packet) => {
		expect(findAcceptancePacketSecret(packet)?.name).toBe(
			"credential assignment",
		);
	});

	test.each([
		'apiKey = "qp_live_123456789"', // acceptance-secret-negative-control
		'access_token: "token-value-123"', // acceptance-secret-negative-control
		'client-secret = "client-secret-value"', // acceptance-secret-negative-control
		'password: "plain-secret-value"', // acceptance-secret-negative-control
	])("keeps generic credential detection blocking: %s", (packet) => {
		expect(findAcceptancePacketSecret(packet)?.name).toBe("generic credential");
	});

	test("masks marked probes only in the exact negative-control diff path", () => {
		const probe =
			'+\t"postgres://questpie:real-secret@localhost/db", // acceptance-secret-negative-control';
		const fixtureDiff = `diff --git a/tests/unit/acceptance-packet-secrets.test.ts b/tests/unit/acceptance-packet-secrets.test.ts\n${probe}`;
		const sourceDiff = `diff --git a/packages/runtime/src/index.ts b/packages/runtime/src/index.ts\n${probe}`;
		const unmarkedFixtureDiff = fixtureDiff.replace(
			" // acceptance-secret-negative-control",
			"",
		);

		expect(findAcceptanceGitDiffSecret(fixtureDiff)).toBeNull();
		expect(findAcceptanceGitDiffSecret(sourceDiff)?.name).toBe("database URL");
		expect(findAcceptanceGitDiffSecret(unmarkedFixtureDiff)?.name).toBe(
			"database URL",
		);
	});
});
