import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { prepareAcceptancePacket } from "../../.agents/skills/questpie-v4/scripts/acceptance-review-packet";

function git(cwd: string, args: string[]) {
	const result = Bun.spawnSync(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0) throw new Error("fixture git operation failed");
	return result.stdout.toString();
}

function fixture(
	base: (source: string) => string | Uint8Array = (source) => source,
) {
	const repositoryPath = mkdtempSync(
		join(tmpdir(), "qp-historical-redaction-"),
	);
	const write = (path: string, text: string | Uint8Array) =>
		writeFileSync(join(repositoryPath, path), text);
	const commit = () => {
		git(repositoryPath, ["add", "."]);
		git(repositoryPath, ["commit", "--quiet", "-m", "fixture"]);
		return git(repositoryPath, ["rev-parse", "HEAD"]).trim();
	};
	try {
		git(repositoryPath, ["init", "--quiet"]);
		git(repositoryPath, ["config", "user.name", "Fixture"]);
		git(repositoryPath, ["config", "user.email", "fixture@example.test"]);
		mkdirSync(join(repositoryPath, "proof"));
		const url = new URL("postgres://localhost/review");
		url.username = "fixture";
		url.password = crypto.randomUUID();
		const secret = url.toString();
		const authority = "# Fixed authority\n";
		write("proof/authority.md", authority);
		write(
			"README.md",
			base(`# Example\nConnect: ${secret}\nKeep this explanation.\n`),
		);
		const diffBase = commit();
		const manifestPath = "proof/manifest.json";
		const manifest: Record<string, unknown> = {
			protocolVersion: 2,
			ticket: "TEST-HISTORICAL-REDACTION",
			proof: "Explicit removal without disclosing historical values",
			diffBase,
			reviewOutput: "proof/REVIEW.json",
			authorityHeads: { base: diffBase },
			authorityDocuments: [
				{
					name: "authority",
					path: "proof/authority.md",
					sha256: createHash("sha256").update(authority).digest("hex"),
				},
			],
			verification: [{ command: "synthetic fixture only", result: "PASS" }],
			acceptanceCriteria: ["Preserve all nonsecret review material."],
			historicalDatabaseUrlRedactions: [{ path: "README.md", baseLine: 2 }],
		};
		write(
			"README.md",
			"# Example\nUse process configuration.\nKeep this explanation.\n",
		);
		const candidate = () => {
			write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
			return {
				repositoryPath,
				manifestPath,
				reviewedHead: commit(),
			};
		};
		return {
			write,
			candidate,
			manifest,
			secret,
			diffBase,
			dispose: () => rmSync(repositoryPath, { recursive: true, force: true }),
		};
	} catch (error) {
		rmSync(repositoryPath, { recursive: true, force: true });
		throw error;
	}
}

test("manifest-bound historical URL removal preserves the complete review scope", () => {
	const input = fixture();
	try {
		const candidate = input.candidate();
		const first = prepareAcceptancePacket(candidate);
		expect(first.packet.includes(input.secret)).toBe(false);
		expect(first.packet).toContain("REDACTED_HISTORICAL_DATABASE_URL_1");
		expect(first.packet).toContain("Keep this explanation.");
		expect(first.packet).toContain("Use process configuration.");
		expect(first.packet).toContain("historical-database-url-redaction-v1");
		expect(first.packet).toContain(
			"manifest-bound historical database URL redactions",
		);
		expect(prepareAcceptancePacket(candidate).packetDigest).toBe(
			first.packetDigest,
		);
	} finally {
		input.dispose();
	}
});

test("rejects lossy UTF-8 rendering before historical redaction", () => {
	const input = fixture((source) =>
		Buffer.concat([Buffer.from(source), Buffer.from([0xff, 10])]),
	);
	try {
		expect(() => {
			prepareAcceptancePacket(input.candidate());
		}).toThrow("UTF-8");
	} finally {
		input.dispose();
	}
});

test.each([
	["missing opt-in", undefined],
	["empty entries", []],
	[
		"duplicate entries",
		[
			{ path: "README.md", baseLine: 2 },
			{ path: "README.md", baseLine: 2 },
		],
	],
	["context line", [{ path: "README.md", baseLine: 1 }]],
	["absent line", [{ path: "README.md", baseLine: 99 }]],
	["added file", [{ path: "proof/manifest.json", baseLine: 2 }]],
	["escaping path", [{ path: "../README.md", baseLine: 2 }]],
	["quoted path", [{ path: '"README.md"', baseLine: 2 }]],
	["control-character path", [{ path: "README.md\n", baseLine: 2 }]],
	["nonpositive line", [{ path: "README.md", baseLine: 0 }]],
	[
		"custom replacement",
		[{ path: "README.md", baseLine: 2, replacement: "hidden" }],
	],
	[
		"excess entries",
		Array.from({ length: 9 }, (_, index) => ({
			path: "README.md",
			baseLine: index + 1,
		})),
	],
] as const)("rejects invalid historical selection: %s", (_name, entries) => {
	const input = fixture();
	try {
		if (entries === undefined)
			delete input.manifest.historicalDatabaseUrlRedactions;
		else input.manifest.historicalDatabaseUrlRedactions = entries;
		expect(() => {
			prepareAcceptancePacket(input.candidate());
		}).toThrow();
	} finally {
		input.dispose();
	}
});

test.each(["README.md", "copied.md", "copied.bin"])(
	"rejects a URL retained at reviewed head in %s",
	(path) => {
		const input = fixture();
		try {
			input.write(
				path,
				path.endsWith(".bin")
					? Buffer.concat([Buffer.from([0]), Buffer.from(input.secret)])
					: input.secret,
			);
			expect(() => {
				prepareAcceptancePacket(input.candidate());
			}).toThrow("remains in reviewed head");
		} finally {
			input.dispose();
		}
	},
);

test("does not excuse another credential on the redacted line", () => {
	const input = fixture((source) =>
		source.replace(
			"\nKeep",
			`; ${["password", crypto.randomUUID()].join("=")}\nKeep`,
		),
	);
	try {
		expect(() => {
			prepareAcceptancePacket(input.candidate());
		}).toThrow("prohibited generic credential");
	} finally {
		input.dispose();
	}
});

test.each([
	"two URL tokens",
	"noncredential URL",
	"malformed URL",
	"binary base",
])("rejects an ineligible base token: %s", (mode) => {
	const input = fixture((source) => {
		const rows = source.split("\n");
		if (mode === "two URL tokens")
			rows[1] += ` ${rows[1]!.slice("Connect: ".length)}`;
		if (mode === "noncredential URL")
			rows[1] = "Connect: postgres://localhost/review";
		if (mode === "malformed URL")
			rows[1] = `Connect: ${["postgres:", "", "[invalid"].join("/")}`;
		if (mode === "binary base")
			return Buffer.concat([Buffer.from(source), Buffer.from([0])]);
		return rows.join("\n");
	});
	try {
		expect(() => {
			prepareAcceptancePacket(input.candidate());
		}).toThrow();
	} finally {
		input.dispose();
	}
});

test("original-diff binding and committed redacted record rederive without a reviewer", () => {
	const input = fixture();
	try {
		const candidate = input.candidate();
		const prepared = prepareAcceptancePacket(candidate);
		const metadata = JSON.parse(
			prepared.packet.match(
				/<historical_redactions>(.*?)<\/historical_redactions>/s,
			)![1]!,
		);
		const raw = git(candidate.repositoryPath, [
			"diff",
			"--binary",
			"--full-index",
			"--no-renames",
			"--no-ext-diff",
			"--no-color",
			"--no-textconv",
			"--no-indent-heuristic",
			"--unified=3",
			"--inter-hunk-context=0",
			"-O/dev/null",
			"--src-prefix=a/",
			"--dst-prefix=b/",
			`${input.diffBase}..${candidate.reviewedHead}`,
			"--",
			".",
		]);
		expect(metadata.originalDiffSha256).toBe(
			createHash("sha256").update(raw).digest("hex"),
		);
		expect(metadata.originalDiffBytes).toBe(Buffer.byteLength(raw));
		expect(metadata.locations).toEqual([
			{ index: 1, path: "README.md", baseLine: 2 },
		]);
		// Synthetic fixture record only: no model verdict or product authority is produced.
		const record = {
			protocolVersion: 2,
			ticket: input.manifest.ticket,
			profile: "questpie.acceptance.v2",
			manifestPath: candidate.manifestPath,
			reviewedHead: candidate.reviewedHead,
			diffBase: input.diffBase,
			packetDigest: prepared.packetDigest,
			primary: {
				profile: "claude-opus-medium-v1",
				disposition: "PASS",
				findings: "VERDICT: PASS\nSynthetic fixture only.",
			},
			verdict: "PASS",
			recordedAt: "2026-09-07T00:00:00.000Z",
		};
		const verify = () =>
			Bun.spawnSync(
				[
					"bun",
					resolve(
						import.meta.dir,
						"../../.agents/skills/questpie-v4/scripts/verify-acceptance-review.ts",
					),
					"--record",
					"proof/REVIEW.json",
				],
				{ cwd: candidate.repositoryPath, stdout: "pipe", stderr: "pipe" },
			);
		input.write("proof/REVIEW.json", JSON.stringify(record));
		git(candidate.repositoryPath, ["add", "."]);
		git(candidate.repositoryPath, [
			"commit",
			"--quiet",
			"-m",
			"synthetic record",
		]);
		expect(verify().exitCode).toBe(0);
		input.write(
			"proof/REVIEW.json",
			JSON.stringify({ ...record, packetDigest: "0".repeat(64) }),
		);
		git(candidate.repositoryPath, ["add", "."]);
		git(candidate.repositoryPath, [
			"commit",
			"--quiet",
			"-m",
			"tampered record",
		]);
		expect(verify().exitCode).not.toBe(0);
	} finally {
		input.dispose();
	}
});
