import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { npmReleaseCommand } from "./publish";

describe("release dry run", () => {
	test("uses npm pack validation instead of a publish command", () => {
		expect(npmReleaseCommand(true)).toBe("npm pack --dry-run --json");
		expect(npmReleaseCommand(true)).not.toContain("publish");
		expect(npmReleaseCommand(false)).toBe(
			"npm publish --access public --provenance",
		);
	});

	test("does not delete or write the publish summary in dry-run mode", () => {
		const source = readFileSync(
			new URL("./publish.ts", import.meta.url),
			"utf8",
		);

		expect(source).toContain(
			"if (!dryRun) fs.rmSync(PUBLISH_SUMMARY_PATH, { force: true });",
		);
		expect(source).toContain("if (publishedNow.length > 0)");
		expect(source).toContain("if (import.meta.main)");
	});
});
