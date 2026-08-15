import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export type Revision = {
	format: string;
	version: number;
	identity: string;
	projectionBase: string;
	originalP2: Record<string, string>;
	cursor: Record<string, unknown>;
	policyDiagnostics: Record<string, string>[];
	acceptedIssues: Record<string, string>;
	readyIssue: string;
	projectionPatches: ProjectionPatch[];
	nonGoals: string[];
};

export type ProjectionPatch = {
	identity: "authorityAndGuidance" | "readinessRepair";
	path: string;
	encoding: "base64";
	sha256: string;
};

const root = resolve(import.meta.dir, "../../../..");
const exact = {
	diffBase: "33662605105d7a80ade94d430dbf3f838964ff69",
	p16: "1d9303a58c9557aac3da648895c817fa039478ba",
	proofHead: "5fbd9058e1cfb3bfef56f11a1d0ec7b6e14e88fa",
	packetBlob: "73b66334fc38360a3ad777498d20ccdc039bcfb9",
	packetSha256:
		"790f06ab8af64ce1099881fcf166b187f072f493ef764cecdb8bfb372ff0dd68",
	policyDigest:
		"972c05336c129b4f4aaabe5f20aee46019497008920d6e02f3193d6353d63bcb",
	projectionSha256:
		"37796a2ff61f2a7bd843ff52ffbb9fd6ad412b009c63564b3177b8a48c09c43b",
	readinessSha256:
		"d91d10052b36ee72043c09e9e4d322a76e3ab1a0556b60db9b57c059c49e04db",
	acceptedIssues: {
		"BETA-01": "20ad8529ee18aba6830a7646acb3a9c9292f2fc6",
		"BETA-02": "b630fb01c6966b97fb3ac265bd416c4cfe0f1908",
		"BETA-03": "a7d24541c433ab502316b34906d97c9dd51f7ee1",
	},
} as const;

function equal(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function validateRevision(revision: Revision): void {
	if (
		revision.format !== "questpie.beta04-authority-revision" ||
		revision.version !== 1 ||
		revision.identity !== "P2R1/BETA04Authority"
	)
		throw new Error("invalid authority revision identity");
	if (revision.projectionBase !== exact.diffBase)
		throw new Error("authority projection base changed");
	if (
		revision.originalP2.status !== "preserved" ||
		revision.originalP2.proofHead !== exact.proofHead ||
		revision.originalP2.acceptancePacketBlob !== exact.packetBlob ||
		revision.originalP2.acceptancePacketSha256 !== exact.packetSha256 ||
		revision.originalP2.messagePolicyProgramDigest !== exact.policyDigest
	)
		throw new Error("original P2 authority changed");
	const cursor = revision.cursor;
	if (
		cursor.foundationalVersion !== 1 ||
		cursor.policyProtectedVersion !== 2 ||
		cursor.policyScopeMember !== "policyScopeDigest" ||
		cursor.policyScopeFormat !== "questpie.policy-cursor-scope" ||
		cursor.policyScopeVersion !== 1 ||
		cursor.digestDomain !== "questpie-policy-cursor-scope-v1\0" ||
		cursor.canonicalEncoding !== "RFC8785+LF" ||
		cursor.base64urlPadding !== "forbidden" ||
		cursor.maximumAsciiBytes !== 2048 ||
		!equal(cursor.usedExecutionFacts, [
			"authorityKind",
			"principalId",
			"tenantId",
		]) ||
		cursor.unusedFacts !== "omitted" ||
		cursor.v1OnPolicyQuery !== "QP-DATA-010" ||
		cursor.scopeMismatch !== "QP-DATA-013" ||
		!equal(cursor.validationOrder, [
			"shape",
			"templateDigest",
			"scopeDigests",
			"sql",
		])
	)
		throw new Error("cursor v2 authority changed");
	if (
		!equal(revision.policyDiagnostics, [
			{
				code: "QP-POLICY-001",
				class: "missingDefaultPolicy",
				phase: "compile",
				blocking: "fatal",
			},
			{
				code: "QP-POLICY-002",
				class: "ambiguousDefaultPolicy",
				phase: "compile",
				blocking: "fatal",
			},
		])
	)
		throw new Error("Policy diagnostic authority changed");
	if (
		!equal(revision.acceptedIssues, exact.acceptedIssues) ||
		revision.readyIssue !== "BETA-04"
	)
		throw new Error("beta readiness authority changed");
	if (
		!equal(revision.projectionPatches, [
			{
				identity: "authorityAndGuidance",
				path: "PROJECTION.patch.b64",
				encoding: "base64",
				sha256: exact.projectionSha256,
			},
			{
				identity: "readinessRepair",
				path: "READINESS.patch.b64",
				encoding: "base64",
				sha256: exact.readinessSha256,
			},
		])
	)
		throw new Error("reviewed projection identity changed");
	for (const required of [
		"production SQL",
		"performance evidence",
		"PolicyProgramV1 byte revision",
		"DataCursorV1 reinterpretation",
		"new Policy diagnostics",
	])
		if (!revision.nonGoals.includes(required))
			throw new Error(`missing authority non-goal ${required}`);
}

function command(args: string[], cwd = root): string {
	const result = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0)
		throw new Error(
			`${args.join(" ")} failed: ${result.stderr.toString().trim()}`,
		);
	return result.stdout.toString().trim();
}

function commandBytes(args: string[], cwd = root): Buffer {
	const result = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0)
		throw new Error(
			`${args.join(" ")} failed: ${result.stderr.toString().trim()}`,
		);
	return Buffer.from(result.stdout);
}

async function decodePatch(path: string): Promise<Buffer> {
	return Buffer.from(await readFile(path, "utf8"), "base64");
}

const allowedPatchPaths = {
	authorityAndGuidance: [
		"apps/docs/content/docs/v4/context-and-policy.mdx",
		"apps/docs/content/docs/v4/data-and-queries.mdx",
		"docs/adr/0008-freeze-the-foundational-data-and-structural-query-contract.md",
		"docs/adr/0010-freeze-trusted-context-and-relational-policy.md",
		"docs/v4/context-and-policy.md",
		"docs/v4/data-model-and-query-grammar.md",
		"docs/v4/implementation/beta04/design-context.md",
		"docs/v4/prototypes/implementation-collapse-p16/QUEUE.json",
	],
	readinessRepair: [
		"docs/v4/prototypes/implementation-collapse-p16/QUEUE.json",
		"docs/v4/prototypes/implementation-collapse-p16/README.md",
		"docs/v4/prototypes/implementation-collapse-p16/check.ts",
		"docs/v4/prototypes/implementation-collapse-p16/negative-control.ts",
	],
} as const;

export function validateProjectionPatch(
	patch: ProjectionPatch,
	contents: Buffer,
): void {
	if (createHash("sha256").update(contents).digest("hex") !== patch.sha256)
		throw new Error(`projection patch changed: ${patch.path}`);
	const paths = [
		...contents.toString().matchAll(/^diff --git a\/(.+) b\/(.+)$/gm),
	].map(([, left, right]) => {
		if (left !== right) throw new Error(`projection renames path: ${left}`);
		return left!;
	});
	if (!equal(paths, allowedPatchPaths[patch.identity]))
		throw new Error(`projection patch crosses authority scope: ${patch.path}`);
}

async function verifyRepositoryEvidence(revision: Revision): Promise<void> {
	const packetPath = "docs/v4/prototypes/context-policy/ACCEPTANCE.md";
	if (
		command(["git", "rev-parse", `${exact.proofHead}:${packetPath}`]) !==
		exact.packetBlob
	)
		throw new Error("original P2 acceptance packet blob changed");
	const packet = commandBytes([
		"git",
		"show",
		`${exact.proofHead}:${packetPath}`,
	]);
	if (createHash("sha256").update(packet).digest("hex") !== exact.packetSha256)
		throw new Error("original P2 acceptance packet digest changed");
	command(["git", "merge-base", "--is-ancestor", exact.p16, exact.diffBase]);
	for (const head of Object.values(exact.acceptedIssues))
		command(["git", "merge-base", "--is-ancestor", head, exact.diffBase]);

	for (const patch of revision.projectionPatches) {
		const path = resolve(import.meta.dir, patch.path);
		const contents = await decodePatch(path);
		validateProjectionPatch(patch, contents);
	}

	const temporary = mkdtempSync(join(tmpdir(), "questpie-beta04-authority-"));
	try {
		command(["git", "worktree", "add", "--detach", temporary, exact.diffBase]);
		for (const patch of revision.projectionPatches) {
			const decodedPath = join(temporary, ".questpie-authority.patch");
			await writeFile(
				decodedPath,
				await decodePatch(resolve(import.meta.dir, patch.path)),
			);
			command(["git", "apply", decodedPath], temporary);
			await rm(decodedPath);
		}
		command(
			[
				process.execPath,
				"run",
				"docs/v4/prototypes/implementation-collapse-p16/check.ts",
			],
			temporary,
		);
		command(
			[
				process.execPath,
				"run",
				"docs/v4/prototypes/implementation-collapse-p16/negative-control.ts",
			],
			temporary,
		);
	} finally {
		Bun.spawnSync(["git", "worktree", "remove", "--force", temporary], {
			cwd: root,
		});
		await rm(temporary, { force: true, recursive: true });
	}
}

export async function loadRevision(): Promise<Revision> {
	return JSON.parse(
		await readFile(resolve(import.meta.dir, "REVISION.json"), "utf8"),
	) as Revision;
}

if (import.meta.main) {
	const revision = await loadRevision();
	validateRevision(revision);
	await verifyRepositoryEvidence(revision);
	console.log("BETA-04 authority revision: immutable P2 and projection PASS");
}
