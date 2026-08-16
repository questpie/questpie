import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, normalize, resolve } from "node:path";

import {
	findAcceptanceGitDiffSecret,
	findAcceptancePacketSecret,
} from "./acceptance-packet-secrets";
import { ACCEPTANCE_REVIEW_PROFILE_V2 } from "./acceptance-review-protocol";

export type AcceptanceManifestV2 = {
	protocolVersion: 2;
	ticket: string;
	proof: string;
	diffBase: string;
	reviewOutput: string;
	authorityHeads: Record<string, string>;
	authorityDocuments: Array<{
		name: string;
		path: string;
		sha256: string;
	}>;
	verification: Array<{ command: string; result: "PASS" }>;
	acceptanceCriteria: string[];
};

export type PreparedAcceptancePacketV2 = {
	manifest: AcceptanceManifestV2;
	manifestPath: string;
	reviewedHead: string;
	packet: string;
	packetDigest: string;
	diffBytes: number;
	documents: number;
};

const MANIFEST_KEYS = [
	"acceptanceCriteria",
	"authorityDocuments",
	"authorityHeads",
	"diffBase",
	"proof",
	"protocolVersion",
	"reviewOutput",
	"ticket",
	"verification",
] as const;

export class AcceptancePacketError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AcceptancePacketError";
	}
}

export function requireNonEmptyReviewDiff(diff: string): string {
	if (diff === "") invalid("review diff is empty");
	return diff;
}

function invalid(message: string): never {
	throw new AcceptancePacketError(message);
}

function shell(
	args: string[],
	cwd: string,
	environment: Record<string, string> = {},
): string {
	const process = Bun.spawnSync(args, {
		cwd,
		env: { ...Bun.env, ...environment },
		stdout: "pipe",
		stderr: "pipe",
	});
	if (process.exitCode !== 0)
		invalid(`${args.join(" ")} failed: ${process.stderr.toString().trim()}`);
	return process.stdout.toString();
}

function sha256(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value: object, expected: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	return (
		actual.length === expected.length &&
		expected.every((key, index) => actual[index] === key)
	);
}

function checkedPath(path: string, label: string): string {
	if (
		!path ||
		isAbsolute(path) ||
		normalize(path) !== path ||
		path === ".." ||
		path.startsWith("../")
	)
		invalid(`${label} must be a normalized repository-relative path: ${path}`);
	return path;
}

function decodeManifest(source: string): AcceptanceManifestV2 {
	let manifest: unknown;
	try {
		manifest = JSON.parse(source);
	} catch (error) {
		invalid(`invalid manifest JSON: ${String(error)}`);
	}
	if (
		typeof manifest !== "object" ||
		manifest === null ||
		Array.isArray(manifest) ||
		!exactKeys(manifest, MANIFEST_KEYS)
	)
		invalid("manifest does not match acceptance protocol v2");
	const candidate = manifest as AcceptanceManifestV2;
	if (
		candidate.protocolVersion !== 2 ||
		!candidate.ticket ||
		!candidate.proof ||
		!/^([0-9a-f]{40})$/.test(candidate.diffBase) ||
		!candidate.reviewOutput
	)
		invalid("manifest lacks exact protocol, ticket, proof, base, or output");
	checkedPath(candidate.reviewOutput, "review output");
	if (
		typeof candidate.authorityHeads !== "object" ||
		candidate.authorityHeads === null ||
		Array.isArray(candidate.authorityHeads) ||
		Object.keys(candidate.authorityHeads).length === 0
	)
		invalid("manifest has no authority heads");
	if (
		!Array.isArray(candidate.verification) ||
		candidate.verification.length === 0 ||
		candidate.verification.some(
			(entry) =>
				typeof entry !== "object" ||
				entry === null ||
				!exactKeys(entry, ["command", "result"]) ||
				!entry.command ||
				entry.result !== "PASS",
		)
	)
		invalid("every verification entry must be PASS");
	if (
		!Array.isArray(candidate.acceptanceCriteria) ||
		candidate.acceptanceCriteria.length === 0 ||
		candidate.acceptanceCriteria.some(
			(criterion) => typeof criterion !== "string" || criterion === "",
		)
	)
		invalid("manifest has no acceptance criteria");
	if (
		!Array.isArray(candidate.authorityDocuments) ||
		candidate.authorityDocuments.length === 0
	)
		invalid("manifest has no authority documents");
	const paths = new Set<string>();
	for (const document of candidate.authorityDocuments) {
		if (
			typeof document !== "object" ||
			document === null ||
			!exactKeys(document, ["name", "path", "sha256"]) ||
			!document.name ||
			!document.path ||
			!/^([0-9a-f]{64})$/.test(document.sha256) ||
			paths.has(document.path)
		)
			invalid("manifest has an invalid or duplicate authority document");
		checkedPath(document.path, "authority document");
		paths.add(document.path);
	}
	return candidate;
}

function xml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

export function prepareAcceptancePacket(input: {
	manifestPath: string;
	reviewedHead: string;
	repositoryPath?: string;
}): PreparedAcceptancePacketV2 {
	const repositoryPath = resolve(input.repositoryPath ?? ".");
	const manifestPath = checkedPath(input.manifestPath, "manifest");
	if (!/^[0-9a-f]{40}$/.test(input.reviewedHead))
		invalid("reviewed head is not a full commit ID");
	const manifest = decodeManifest(
		shell(
			["git", "show", `${input.reviewedHead}:${manifestPath}`],
			repositoryPath,
		),
	);
	shell(
		[
			"git",
			"merge-base",
			"--is-ancestor",
			manifest.diffBase,
			input.reviewedHead,
		],
		repositoryPath,
	);
	for (const [name, authorityHead] of Object.entries(manifest.authorityHeads)) {
		if (!/^[0-9a-f]{40}$/.test(authorityHead))
			invalid(`authority head ${name} is not a full commit ID`);
		shell(
			["git", "cat-file", "-e", `${authorityHead}^{commit}`],
			repositoryPath,
		);
		shell(
			["git", "merge-base", "--is-ancestor", authorityHead, input.reviewedHead],
			repositoryPath,
		);
	}

	const documents = manifest.authorityDocuments
		.map((document, index) => {
			const content = shell(
				["git", "show", `${input.reviewedHead}:${document.path}`],
				repositoryPath,
			);
			if (sha256(content) !== document.sha256)
				invalid(`authority document digest mismatch: ${document.path}`);
			const secret = findAcceptancePacketSecret(content);
			if (secret)
				invalid(
					`authority contains a prohibited ${secret.name}: ${document.path}`,
				);
			return `<document index="${index + 1}"><source>${xml(document.path)}</source><document_content>${xml(content)}</document_content></document>`;
		})
		.join("\n");
	const manifestSecret = findAcceptancePacketSecret(JSON.stringify(manifest));
	if (manifestSecret)
		invalid(`manifest contains a prohibited ${manifestSecret.name}`);
	const administrativeAttributes = shell(
		["git", "rev-parse", "--git-path", "info/attributes"],
		repositoryPath,
	).trim();
	if (
		existsSync(resolve(repositoryPath, administrativeAttributes)) &&
		readFileSync(
			resolve(repositoryPath, administrativeAttributes),
			"utf8",
		).trim() !== ""
	)
		invalid("Git administrative attributes are not allowed during review");
	const diff = requireNonEmptyReviewDiff(
		shell(
			[
				"git",
				"-c",
				"core.quotePath=true",
				"-c",
				"diff.noprefix=false",
				"-c",
				"diff.mnemonicPrefix=false",
				"-c",
				"diff.renames=false",
				"-c",
				"diff.algorithm=myers",
				"-c",
				"core.attributesFile=/dev/null",
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
				"--ignore-submodules=none",
				"--submodule=short",
				"-O/dev/null",
				"--src-prefix=a/",
				"--dst-prefix=b/",
				`${manifest.diffBase}..${input.reviewedHead}`,
				"--",
				".",
			],
			repositoryPath,
			{ GIT_ATTR_SOURCE: input.reviewedHead },
		),
	);
	const diffSecret = findAcceptanceGitDiffSecret(diff);
	if (diffSecret)
		invalid(`review diff contains a prohibited ${diffSecret.name}`);

	const packet = `<documents>\n${documents}\n<document index="${manifest.authorityDocuments.length + 1}"><source>${xml(manifestPath)}</source><document_content>${xml(JSON.stringify(manifest, null, 2))}</document_content></document>\n<document index="${manifest.authorityDocuments.length + 2}"><source>exact git diff ${xml(manifest.diffBase)}..${xml(input.reviewedHead)}</source><document_content>${xml(diff)}</document_content></document>\n</documents>\n<review_metadata><protocol_version>2</protocol_version><reviewed_head>${xml(input.reviewedHead)}</reviewed_head><diff_base>${xml(manifest.diffBase)}</diff_base><primary_model>opus</primary_model><primary_effort>medium</primary_effort><contingency_model>${ACCEPTANCE_REVIEW_PROFILE_V2.model}</contingency_model><contingency_effort>${ACCEPTANCE_REVIEW_PROFILE_V2.effort}</contingency_effort></review_metadata>\n<review_task>\nYou are the independent acceptance reviewer for QUESTPIE v4 ticket ${xml(manifest.ticket)}. Review only the exact packet against its fixed authority, proof manifest, verification results, and acceptance criteria. Look for contradictions, missing evidence, invalid ownership, unsafe review behavior, false quality or performance gates, and scope creep. Return exactly one verdict line first: VERDICT: PASS or VERDICT: BLOCKED. A PASS means no blocking finding remains. For BLOCKED, list every concrete blocker with the affected file and required evidence or repair, followed by non-blocking observations.\n</review_task>\n`;
	return Object.freeze({
		manifest,
		manifestPath,
		reviewedHead: input.reviewedHead,
		packet,
		packetDigest: sha256(packet),
		diffBytes: Buffer.byteLength(diff),
		documents: manifest.authorityDocuments.length + 2,
	});
}
