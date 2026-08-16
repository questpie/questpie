import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	AcceptancePacketError,
	prepareAcceptancePacket,
} from "../../.agents/skills/questpie-v4/scripts/acceptance-review-packet";

function run(repositoryPath: string, args: string[]): string {
	const result = Bun.spawnSync(args, {
		cwd: repositoryPath,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return result.stdout.toString().trim();
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function fixture() {
	const repositoryPath = mkdtempSync(join(tmpdir(), "qp-acceptance-v2-"));
	run(repositoryPath, ["git", "init", "--quiet"]);
	run(repositoryPath, ["git", "config", "user.email", "agent@example.test"]);
	run(repositoryPath, ["git", "config", "user.name", "Acceptance Test"]);
	mkdirSync(join(repositoryPath, "proof"));
	writeFileSync(join(repositoryPath, "proof", "authority.md"), "# Authority\n");
	writeFileSync(
		join(repositoryPath, "implementation.ts"),
		"export const v = 1;\n",
	);
	run(repositoryPath, ["git", "add", "."]);
	run(repositoryPath, ["git", "commit", "--quiet", "-m", "base"]);
	const diffBase = run(repositoryPath, ["git", "rev-parse", "HEAD"]);

	writeFileSync(
		join(repositoryPath, "implementation.ts"),
		"export const v = 2;\n",
	);
	const manifestPath = "proof/acceptance-manifest.json";
	const manifest = {
		protocolVersion: 2,
		ticket: "#fixture",
		proof: "packet fixture",
		diffBase,
		reviewOutput: "proof/REVIEW.json",
		authorityHeads: { foundation: diffBase },
		authorityDocuments: [
			{
				name: "authority",
				path: "proof/authority.md",
				sha256: sha256("# Authority\n"),
			},
		],
		verification: [{ command: "bun test", result: "PASS" }],
		acceptanceCriteria: ["The packet is exact."],
	};
	writeFileSync(
		join(repositoryPath, manifestPath),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	run(repositoryPath, ["git", "add", "."]);
	run(repositoryPath, ["git", "commit", "--quiet", "-m", "candidate"]);
	const reviewedHead = run(repositoryPath, ["git", "rev-parse", "HEAD"]);
	return { repositoryPath, manifestPath, manifest, reviewedHead };
}

describe("acceptance packet v2", () => {
	test("re-derives byte-identical packet bytes from one exact commit", () => {
		const input = fixture();
		const first = prepareAcceptancePacket(input);
		const second = prepareAcceptancePacket(input);

		expect(second.packet).toBe(first.packet);
		expect(second.packetDigest).toBe(first.packetDigest);
		expect(first.packetDigest).toMatch(/^[0-9a-f]{64}$/);
		expect(first.documents).toBe(3);
		expect(first.diffBytes).toBeGreaterThan(0);
	});

	test("rejects substituted authority, non-ancestor base, and path escape", () => {
		for (const mutate of [
			(manifest: ReturnType<typeof fixture>["manifest"]) => {
				manifest.authorityDocuments[0]!.sha256 = "f".repeat(64);
			},
			(manifest: ReturnType<typeof fixture>["manifest"]) => {
				manifest.diffBase = "f".repeat(40);
			},
			(manifest: ReturnType<typeof fixture>["manifest"]) => {
				manifest.reviewOutput = "../REVIEW.json";
			},
		]) {
			const input = fixture();
			mutate(input.manifest);
			writeFileSync(
				join(input.repositoryPath, input.manifestPath),
				`${JSON.stringify(input.manifest, null, 2)}\n`,
			);
			run(input.repositoryPath, ["git", "add", "."]);
			run(input.repositoryPath, ["git", "commit", "--quiet", "-m", "tamper"]);
			input.reviewedHead = run(input.repositoryPath, [
				"git",
				"rev-parse",
				"HEAD",
			]);
			expect(() => prepareAcceptancePacket(input)).toThrow(
				AcceptancePacketError,
			);
		}
	});
});
