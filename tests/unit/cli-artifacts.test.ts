import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	committedArtifactDirectories,
	loadGeneratedSchemaProjection,
	requestedPort,
} from "../../packages/questpie/cli/artifacts";

test("discovers committed artifacts in deterministic order", async () => {
	const root = await mkdtemp(join(tmpdir(), "questpie-cli-artifacts-"));
	try {
		await Promise.all([
			mkdir(join(root, "questpie/seeds/zeta"), { recursive: true }),
			mkdir(join(root, "questpie/seeds/alpha"), { recursive: true }),
			mkdir(join(root, ".questpie/generated"), { recursive: true }),
		]);
		await writeFile(
			join(root, ".questpie/generated/schema-projection.json"),
			'{"format":"questpie.schema"}\n',
		);
		expect(await committedArtifactDirectories(root, "seeds")).toEqual([
			join(root, "questpie/seeds/alpha"),
			join(root, "questpie/seeds/zeta"),
		]);
		expect(await loadGeneratedSchemaProjection(root)).toEqual({
			format: "questpie.schema",
		});
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test("start accepts --port and lets it override PORT", () => {
	expect(requestedPort([], "3200")).toBe(3200);
	expect(requestedPort(["--port", "0"], "3200")).toBe(0);
	expect(requestedPort(["--port=4100"], undefined)).toBe(4100);
	expect(() => requestedPort(["--port", "nope"], undefined)).toThrow(
		"port must be an integer",
	);
	for (const invalid of [["--port"], ["--port="], []] as const)
		expect(() =>
			requestedPort(invalid, invalid.length === 0 ? "" : undefined),
		).toThrow("port must be an integer");
});
