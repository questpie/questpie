import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	AcceptanceRecordError,
	decodeAcceptanceReviewRecord,
} from "../../.agents/skills/questpie-v4/scripts/acceptance-review-record";

const VERIFIER = resolve(
	import.meta.dir,
	"../../.agents/skills/questpie-v4/scripts/verify-acceptance-review.ts",
);

function run(cwd: string, args: string[]): string {
	const result = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return result.stdout.toString().trim();
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

const expected = {
	ticket: "#317",
	manifestPath: "proof/acceptance-manifest.json",
	reviewedHead: "b".repeat(40),
	diffBase: "c".repeat(40),
	packetDigest: "a".repeat(64),
};

function record(): Record<string, unknown> {
	return {
		protocolVersion: 2,
		ticket: expected.ticket,
		profile: "questpie.acceptance.v2",
		manifestPath: expected.manifestPath,
		reviewedHead: expected.reviewedHead,
		diffBase: expected.diffBase,
		packetDigest: expected.packetDigest,
		primary: {
			profile: "claude-opus-medium-v1",
			disposition: "PASS",
			findings: "VERDICT: PASS\nno blocking finding remains",
		},
		verdict: "PASS",
		recordedAt: "2026-08-17T10:41:54.483Z",
	};
}

describe("acceptance record binding", () => {
	test("accepts a record bound to its prepared packet", () => {
		expect(() =>
			decodeAcceptanceReviewRecord(record(), expected),
		).not.toThrow();
	});

	test("rejects a substitution in every bound field", () => {
		// Each of these is a value the record is supposed to pin. Substituting any
		// one of them is how a record from one packet gets replayed against
		// another, so every one must fail closed on its own.
		for (const [field, value] of [
			["packetDigest", "d".repeat(64)],
			["reviewedHead", "e".repeat(40)],
			["diffBase", "f".repeat(40)],
			["manifestPath", "proof/other-manifest.json"],
			["ticket", "#999"],
			["profile", "questpie.acceptance.v1"],
			["protocolVersion", 1],
		] as const) {
			const changed = record();
			changed[field] = value;
			expect(() => decodeAcceptanceReviewRecord(changed, expected)).toThrow(
				AcceptanceRecordError,
			);
		}
	});

	test("rejects a verdict that disagrees with the primary disposition", () => {
		const changed = record();
		changed.verdict = "BLOCKED";
		expect(() => decodeAcceptanceReviewRecord(changed, expected)).toThrow(
			AcceptanceRecordError,
		);
	});

	test("rejects findings whose verdict line does not match", () => {
		for (const findings of [
			"VERDICT: BLOCKED\none blocker",
			"no verdict line at all",
			"VERDICT: PASS\nVERDICT: PASS",
			"preamble\nVERDICT: PASS",
		]) {
			const changed = record();
			(changed.primary as Record<string, unknown>).findings = findings;
			expect(() => decodeAcceptanceReviewRecord(changed, expected)).toThrow(
				AcceptanceRecordError,
			);
		}
	});

	test("rejects a non-ISO or non-canonical timestamp", () => {
		for (const recordedAt of [
			"2026-08-17",
			"17/08/2026",
			"2026-08-17T10:41:54.483+02:00",
			"",
		]) {
			const changed = record();
			changed.recordedAt = recordedAt;
			expect(() => decodeAcceptanceReviewRecord(changed, expected)).toThrow(
				AcceptanceRecordError,
			);
		}
	});

	test("rejects an unknown or missing key", () => {
		const extra = record();
		extra.contingency = { verdict: "PASS" };
		expect(() => decodeAcceptanceReviewRecord(extra, expected)).toThrow(
			AcceptanceRecordError,
		);
		const missing = record();
		delete missing.packetDigest;
		expect(() => decodeAcceptanceReviewRecord(missing, expected)).toThrow(
			AcceptanceRecordError,
		);
	});

	test("rejects a no-result recorded as an acceptance verdict", () => {
		// There is one reviewer, so a record that carries no verdict cannot also
		// carry an aggregate one. This is what makes an outage unable to pass.
		const changed = record();
		changed.primary = {
			profile: "claude-opus-medium-v1",
			disposition: "NO_RESULT",
			category: "transport",
		};
		expect(() => decodeAcceptanceReviewRecord(changed, expected)).toThrow(
			AcceptanceRecordError,
		);
	});
});

describe("credential-free record verification", () => {
	function fixture(verdict: "PASS" | "BLOCKED") {
		const repositoryPath = mkdtempSync(join(tmpdir(), "qp-verify-"));
		run(repositoryPath, ["git", "init", "--quiet"]);
		run(repositoryPath, ["git", "config", "user.email", "agent@example.test"]);
		run(repositoryPath, ["git", "config", "user.name", "Acceptance Test"]);
		mkdirSync(join(repositoryPath, "proof"));
		writeFileSync(
			join(repositoryPath, "proof", "authority.md"),
			"# Authority\n",
		);
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
		writeFileSync(
			join(repositoryPath, manifestPath),
			`${JSON.stringify(
				{
					protocolVersion: 2,
					ticket: "#fixture",
					proof: "verification fixture",
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
					acceptanceCriteria: ["The record verifies without credentials."],
				},
				null,
				2,
			)}\n`,
		);
		run(repositoryPath, ["git", "add", "."]);
		run(repositoryPath, ["git", "commit", "--quiet", "-m", "candidate"]);
		const reviewedHead = run(repositoryPath, ["git", "rev-parse", "HEAD"]);

		// Re-derive the digest the same way the wrapper does, by preparing the
		// packet from the committed commit rather than from the working tree.
		const digest = JSON.parse(
			run(repositoryPath, [
				"bun",
				resolve(
					import.meta.dir,
					"../../.agents/skills/questpie-v4/scripts/acceptance-review.ts",
				),
				"--manifest",
				manifestPath,
				"--dry-run",
			]),
		).packetDigest as string;

		writeFileSync(
			join(repositoryPath, "proof", "REVIEW.json"),
			`${JSON.stringify(
				{
					protocolVersion: 2,
					ticket: "#fixture",
					profile: "questpie.acceptance.v2",
					manifestPath,
					reviewedHead,
					diffBase,
					packetDigest: digest,
					primary: {
						profile: "claude-opus-medium-v1",
						disposition: verdict,
						findings: `VERDICT: ${verdict}\nfixture`,
					},
					verdict,
					recordedAt: "2026-08-17T10:41:54.483Z",
				},
				null,
				"\t",
			)}\n`,
		);
		run(repositoryPath, ["git", "add", "."]);
		run(repositoryPath, ["git", "commit", "--quiet", "-m", "record"]);
		return { repositoryPath, recordPath: "proof/REVIEW.json" };
	}

	function verify(repositoryPath: string, recordPath: string) {
		return Bun.spawnSync(["bun", VERIFIER, "--record", recordPath], {
			cwd: repositoryPath,
			stdout: "pipe",
			stderr: "pipe",
		});
	}

	test("verifies a committed passing record with no model credentials", () => {
		const { repositoryPath, recordPath } = fixture("PASS");
		const result = verify(repositoryPath, recordPath);
		expect(result.stderr.toString()).toBe("");
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toContain(
			"acceptance review verification",
		);
	});

	test("fails closed on a blocked record", () => {
		const { repositoryPath, recordPath } = fixture("BLOCKED");
		const result = verify(repositoryPath, recordPath);
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain("not PASS");
	});

	test("fails closed when the committed record is edited in the working tree", () => {
		const { repositoryPath, recordPath } = fixture("PASS");
		const onDisk = join(repositoryPath, recordPath);
		const tampered = JSON.parse(
			run(repositoryPath, ["cat", recordPath]),
		) as Record<string, unknown>;
		tampered.packetDigest = "0".repeat(64);
		writeFileSync(onDisk, `${JSON.stringify(tampered, null, "\t")}\n`);
		const result = verify(repositoryPath, recordPath);
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain("differs from committed HEAD");
	});
});
