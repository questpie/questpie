import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, normalize, relative, resolve } from "node:path";

import { findAcceptancePacketSecret } from "./acceptance-packet-secrets";
import {
	AcceptancePacketError,
	prepareAcceptancePacket,
} from "./acceptance-review-packet";
import { decodeAcceptanceReviewRecord } from "./acceptance-review-record";
import {
	AcceptanceReviewSafetyError,
	requireAbsentReviewOutput,
	requireCleanReviewTree,
} from "./acceptance-review-safety";
import {
	PrimaryReviewerUnavailable,
	runPrimaryAcceptanceReview,
	spawnPrimaryReviewerProbe,
	verifyPrimaryReviewer,
} from "./claude-acceptance-primary";

type Options = {
	manifest?: string;
	timeoutMs: number;
	dryRun: boolean;
};

function fail(message: string): never {
	console.error(`acceptance review: ${message}`);
	process.exit(1);
}

function parseArgs(argv: string[]): Options {
	const options: Options = { timeoutMs: 300_000, dryRun: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const value = argv[index + 1];
		if (arg === "--manifest" && value) {
			options.manifest = value;
			index += 1;
		} else if (arg === "--timeout-ms" && value) {
			options.timeoutMs = Number.parseInt(value, 10);
			index += 1;
		} else if (arg === "--dry-run") {
			options.dryRun = true;
		} else {
			fail(`unknown or incomplete argument: ${arg}`);
		}
	}
	if (!options.manifest) fail("require --manifest");
	if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1_000)
		fail("--timeout-ms must be an integer of at least 1000");
	return options;
}

function checkedRepositoryPath(path: string, label: string): string {
	if (
		!path ||
		isAbsolute(path) ||
		normalize(path) !== path ||
		path === ".." ||
		path.startsWith("../")
	)
		fail(`${label} must be a normalized repository-relative path: ${path}`);
	const absolute = resolve(path);
	const fromRoot = relative(process.cwd(), absolute);
	if (fromRoot === ".." || fromRoot.startsWith("../"))
		fail(`${label} escapes the repository: ${path}`);
	return absolute;
}

function shell(args: string[]): string {
	const process = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
	if (process.exitCode !== 0)
		fail(`${args.join(" ")} failed: ${process.stderr.toString().trim()}`);
	return process.stdout.toString().trim();
}

const options = parseArgs(Bun.argv.slice(2));
const head = shell(["git", "rev-parse", "HEAD"]);
try {
	requireCleanReviewTree(
		shell(["git", "status", "--porcelain=v1", "--untracked-files=all"]),
	);
} catch (error) {
	if (error instanceof AcceptanceReviewSafetyError) fail(error.message);
	throw error;
}

let prepared: ReturnType<typeof prepareAcceptancePacket>;
try {
	prepared = prepareAcceptancePacket({
		manifestPath: options.manifest!,
		reviewedHead: head,
	});
} catch (error) {
	if (error instanceof AcceptancePacketError) fail(error.message);
	throw error;
}
const outputPath = checkedRepositoryPath(
	prepared.manifest.reviewOutput,
	"review output",
);
try {
	requireAbsentReviewOutput(outputPath, process.cwd(), [
		shell(["git", "rev-parse", "--absolute-git-dir"]),
		shell(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"]),
	]);
} catch (error) {
	if (error instanceof AcceptanceReviewSafetyError) fail(error.message);
	throw error;
}

if (options.dryRun) {
	console.log(
		JSON.stringify({
			protocolVersion: 2,
			ticket: prepared.manifest.ticket,
			head,
			documents: prepared.documents,
			packetBytes: Buffer.byteLength(prepared.packet),
			diffBytes: prepared.diffBytes,
			packetDigest: prepared.packetDigest,
		}),
	);
	process.exit(0);
}

try {
	verifyPrimaryReviewer(spawnPrimaryReviewerProbe);
} catch (error) {
	if (error instanceof PrimaryReviewerUnavailable) fail(error.message);
	throw error;
}
const primary = await runPrimaryAcceptanceReview({
	packet: prepared.packet,
	cwd: process.cwd(),
	timeoutMs: options.timeoutMs,
});
// One reviewer, one disposition. A timeout, transport failure, empty response,
// or unparsable response is a no result and writes no artifact, so an outage
// can never be mistaken for a verdict in either direction.
if (primary.disposition === "NO_RESULT")
	fail(
		`primary produced no result: ${primary.category}${
			primary.diagnostic ? ` (${primary.diagnostic})` : ""
		}`,
	);
const verdict = primary.disposition;

const record = {
	protocolVersion: 2,
	ticket: prepared.manifest.ticket,
	profile: "questpie.acceptance.v2",
	manifestPath: prepared.manifestPath,
	reviewedHead: head,
	diffBase: prepared.manifest.diffBase,
	packetDigest: prepared.packetDigest,
	primary: { profile: "claude-opus-medium-v1" as const, ...primary },
	verdict,
	recordedAt: new Date().toISOString(),
};
decodeAcceptanceReviewRecord(record, {
	ticket: prepared.manifest.ticket,
	manifestPath: prepared.manifestPath,
	reviewedHead: head,
	diffBase: prepared.manifest.diffBase,
	packetDigest: prepared.packetDigest,
});
const recordSecret = findAcceptancePacketSecret(JSON.stringify(record));
if (recordSecret)
	fail(`review record contains a prohibited ${recordSecret.name}`);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(record, null, "\t")}\n`, {
	flag: "wx",
});
console.log(`acceptance review ${verdict}: ${prepared.manifest.reviewOutput}`);
if (verdict === "BLOCKED") process.exit(2);
