import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, normalize, resolve } from "node:path";

import {
	decodeHistoricalRedactions,
	HistoricalRedactionError,
	type HistoricalDatabaseUrlRedaction,
	redactHistoricalDatabaseUrls,
} from "./acceptance-historical-redactions";
import {
	findAcceptanceGitDiffSecret,
	findAcceptancePacketSecret,
} from "./acceptance-packet-secrets";
import {
	ACCEPTANCE_PRIMARY_PROFILE_V2,
	type AcceptancePrimaryProfileV2,
	FABLE_BETA2_PRIMARY_PROFILE_V2,
} from "./claude-acceptance-primary";

export type AcceptanceReviewerProfileV2 =
	typeof FABLE_BETA2_PRIMARY_PROFILE_V2.recordProfile;

export type AcceptanceManifestV2 = {
	protocolVersion: 2;
	ticket: string;
	proof: string;
	diffBase: string;
	reviewOutput: string;
	reviewerProfile?: AcceptanceReviewerProfileV2;
	historicalDatabaseUrlRedactions?: HistoricalDatabaseUrlRedaction[];
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
	reviewerProfile:
		| typeof ACCEPTANCE_PRIMARY_PROFILE_V2.recordProfile
		| AcceptanceReviewerProfileV2;
	primaryProfile: AcceptancePrimaryProfileV2;
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

const FABLE_BETA2_TICKET = "BETA2-ACCEPTANCE";

function primaryProfileForManifest(
	manifest: Pick<AcceptanceManifestV2, "reviewerProfile" | "ticket">,
): AcceptancePrimaryProfileV2 {
	if (manifest.reviewerProfile === undefined)
		return ACCEPTANCE_PRIMARY_PROFILE_V2;
	if (
		manifest.reviewerProfile === FABLE_BETA2_PRIMARY_PROFILE_V2.recordProfile &&
		manifest.ticket === FABLE_BETA2_TICKET
	)
		return FABLE_BETA2_PRIMARY_PROFILE_V2;
	invalid("reviewer profile is not authorized for this acceptance ticket");
}

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

function shellBytes(
	args: string[],
	cwd: string,
	environment: Record<string, string> = {},
): Buffer {
	const process = Bun.spawnSync(args, {
		cwd,
		env: { ...Bun.env, ...environment },
		stdout: "pipe",
		stderr: "pipe",
	});
	if (process.exitCode !== 0)
		invalid(`${args.join(" ")} failed: ${process.stderr.toString().trim()}`);
	return process.stdout;
}

function shell(
	args: string[],
	cwd: string,
	environment: Record<string, string> = {},
): string {
	return shellBytes(args, cwd, environment).toString();
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
		!exactKeys(
			manifest,
			[
				...MANIFEST_KEYS,
				...(Object.hasOwn(manifest, "reviewerProfile")
					? ["reviewerProfile"]
					: []),
				...(Object.hasOwn(manifest, "historicalDatabaseUrlRedactions")
					? ["historicalDatabaseUrlRedactions"]
					: []),
			].sort(),
		)
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
	primaryProfileForManifest(candidate);
	if (Object.hasOwn(candidate, "historicalDatabaseUrlRedactions")) {
		try {
			decodeHistoricalRedactions(candidate.historicalDatabaseUrlRedactions);
		} catch (error) {
			if (error instanceof HistoricalRedactionError) invalid(error.message);
			throw error;
		}
	}
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
	const rawDiff = shellBytes(
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
	);
	const diff = requireNonEmptyReviewDiff(rawDiff.toString());
	let renderedDiff = diff;
	let redactionMetadata = "";
	if (manifest.historicalDatabaseUrlRedactions) {
		if (!Buffer.from(diff).equals(rawDiff))
			invalid("historical redaction requires lossless UTF-8 diff bytes");
		try {
			const redacted = redactHistoricalDatabaseUrls({
				diff,
				entries: manifest.historicalDatabaseUrlRedactions,
				readBase: (path) =>
					shell(
						["git", "show", `${manifest.diffBase}:${path}`],
						repositoryPath,
					),
				presentAtHead: (value) => {
					const search = Bun.spawnSync(
						[
							"git",
							"grep",
							"-a",
							"-F",
							"-q",
							"-f",
							"-",
							input.reviewedHead,
							"--",
						],
						{
							cwd: repositoryPath,
							stdin: Buffer.from(`${value}\n`),
							stdout: "ignore",
							stderr: "ignore",
						},
					);
					if (search.exitCode === 0) return true;
					if (search.exitCode === 1) return false;
					invalid("cannot verify historical URL absence at reviewed head");
				},
			});
			renderedDiff = redacted.diff;
			redactionMetadata = `<historical_redactions>${xml(
				JSON.stringify({
					version: "historical-database-url-redaction-v1",
					originalDiffSha256: sha256(rawDiff),
					originalDiffBytes: rawDiff.byteLength,
					locations: redacted.locations,
				}),
			)}</historical_redactions>`;
		} catch (error) {
			if (error instanceof HistoricalRedactionError) invalid(error.message);
			throw error;
		}
	}
	const diffSecret = findAcceptanceGitDiffSecret(renderedDiff, (path, side) =>
		shell(
			[
				"git",
				"show",
				`${side === "base" ? manifest.diffBase : input.reviewedHead}:${path}`,
			],
			repositoryPath,
		),
	);
	if (diffSecret)
		invalid(`review diff contains a prohibited ${diffSecret.name}`);

	const primaryProfile = primaryProfileForManifest(manifest);
	const profileMetadata = manifest.reviewerProfile
		? `<primary_profile>${xml(primaryProfile.recordProfile)}</primary_profile>`
		: "";
	const diffLabel = redactionMetadata
		? `exact git diff with ${manifest.historicalDatabaseUrlRedactions!.length} manifest-bound historical database URL redactions`
		: "exact git diff";
	const packet = `<documents>\n${documents}\n<document index="${manifest.authorityDocuments.length + 1}"><source>${xml(manifestPath)}</source><document_content>${xml(JSON.stringify(manifest, null, 2))}</document_content></document>\n<document index="${manifest.authorityDocuments.length + 2}"><source>${diffLabel} ${xml(manifest.diffBase)}..${xml(input.reviewedHead)}</source><document_content>${xml(renderedDiff)}</document_content></document>\n</documents>\n<review_metadata><protocol_version>2</protocol_version><reviewed_head>${xml(input.reviewedHead)}</reviewed_head><diff_base>${xml(manifest.diffBase)}</diff_base><primary_model>${xml(primaryProfile.model)}</primary_model><primary_effort>${xml(primaryProfile.effort)}</primary_effort>${profileMetadata}${redactionMetadata}</review_metadata>\n<review_task>\nYou are the independent acceptance reviewer for QUESTPIE v4 ticket ${xml(manifest.ticket)}. Review only the exact packet against its fixed authority, proof manifest, verification results, and acceptance criteria. Look for contradictions, missing evidence, invalid ownership, unsafe review behavior, false quality or performance gates, and scope creep. Return exactly one verdict line first: VERDICT: PASS or VERDICT: BLOCKED. A PASS means no blocking finding remains. For BLOCKED, list every concrete blocker with the affected file and required evidence or repair, followed by non-blocking observations.\n</review_task>\n`;
	return Object.freeze({
		manifest,
		manifestPath,
		reviewedHead: input.reviewedHead,
		packet,
		packetDigest: sha256(packet),
		diffBytes: Buffer.byteLength(diff),
		documents: manifest.authorityDocuments.length + 2,
		reviewerProfile: primaryProfile.recordProfile,
		primaryProfile,
	});
}
