import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	committedArtifactDirectories,
	loadGeneratedMcpProjectionExplanation,
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

test("loads the generated MCP explanation bytes without rebuilding", async () => {
	const root = await mkdtemp(join(tmpdir(), "questpie-cli-mcp-explain-"));
	try {
		const bytes =
			'{"format":"questpie.mcp-projection-explain","version":1,"selected":true}\n';
		await mkdir(join(root, ".questpie/generated"), { recursive: true });
		await writeFile(
			join(root, ".questpie/generated/mcp-projection-explain.json"),
			bytes,
		);
		expect(await loadGeneratedMcpProjectionExplanation(root)).toBe(bytes);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test("prints only the exact generated MCP explanation for the exact command", async () => {
	const root = await mkdtemp(join(tmpdir(), "questpie-cli-mcp-command-"));
	try {
		const bytes =
			'{"format":"questpie.mcp-projection-explain","version":1,"selected":true}\n';
		await mkdir(join(root, ".questpie/generated"), { recursive: true });
		await writeFile(
			join(root, ".questpie/generated/mcp-projection-explain.json"),
			bytes,
		);
		const cli = resolve(
			import.meta.dir,
			"../../packages/questpie/cli/questpie.ts",
		);
		const accepted = Bun.spawnSync(
			["bun", cli, "explain", "projection", "mcp"],
			{ cwd: root, stdout: "pipe", stderr: "pipe" },
		);
		expect(accepted.exitCode).toBe(0);
		expect(accepted.stdout.toString()).toBe(bytes);
		expect(accepted.stderr.toString()).toBe("");

		const broadened = Bun.spawnSync(
			["bun", cli, "explain", "projection", "mcp", "--json"],
			{ cwd: root, stdout: "pipe", stderr: "pipe" },
		);
		expect(broadened.exitCode).toBe(1);
		expect(broadened.stdout.toString()).toBe("");
		expect(broadened.stderr.toString()).toBe(
			"questpie: use explain projection mcp\n",
		);
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
