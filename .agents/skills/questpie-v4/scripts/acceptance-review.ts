import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, normalize, relative, resolve } from "node:path";

import { findAcceptancePacketSecret } from "./acceptance-packet-secrets";
import {
	AcceptancePacketError,
	prepareAcceptancePacket,
} from "./acceptance-review-packet";
import {
	AcceptanceReviewNoResult,
	resolveAcceptanceReview,
	runContingencyAcceptanceReview,
	type PrimaryAcceptanceReviewV2,
} from "./acceptance-review-protocol";
import { decodeAcceptanceReviewRecord } from "./acceptance-review-record";
import {
	AcceptanceReviewSafetyError,
	requireAbsentReviewOutput,
	requireCleanReviewTree,
} from "./acceptance-review-safety";
import { runBoundedReviewProcess } from "./bounded-review-process";
import { createCodexAcceptanceReviewer } from "./codex-acceptance-reviewer";

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

async function runPrimaryReview(
	packet: string,
	timeoutMs: number,
): Promise<PrimaryAcceptanceReviewV2> {
	let completed: Awaited<ReturnType<typeof runBoundedReviewProcess>>;
	try {
		completed = await runBoundedReviewProcess({
			command: [
				"claude",
				"--print",
				"--model",
				"opus",
				"--effort",
				"medium",
				"--no-session-persistence",
				"--permission-mode",
				"dontAsk",
				"--tools",
				"",
			],
			cwd: process.cwd(),
			stdin: packet,
			timeoutMs,
		});
	} catch {
		return { disposition: "NO_RESULT", category: "transport" };
	}
	if (completed.timedOut)
		return { disposition: "NO_RESULT", category: "timeout" };
	const raw = completed.stdout.trim();
	if (completed.exitCode !== 0)
		return { disposition: "NO_RESULT", category: "transport" };
	if (raw === "") return { disposition: "NO_RESULT", category: "empty" };
	const verdicts = [...raw.matchAll(/^VERDICT:\s*(PASS|BLOCKED)\s*$/gm)].map(
		(match) => match[1],
	);
	if (verdicts.length !== 1 || !raw.startsWith("VERDICT:"))
		return { disposition: "NO_RESULT", category: "invalid" };
	return {
		disposition: verdicts[0] as "PASS" | "BLOCKED",
		findings: raw,
	};
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

const primary = await runPrimaryReview(prepared.packet, options.timeoutMs);
let resolved: Awaited<ReturnType<typeof resolveAcceptanceReview>>;
try {
	resolved = await resolveAcceptanceReview(primary, () =>
		runContingencyAcceptanceReview(
			{
				packet: prepared.packet,
				packetDigest: prepared.packetDigest,
				reviewedHead: head,
				diffBase: prepared.manifest.diffBase,
				timeoutMs: options.timeoutMs,
			},
			createCodexAcceptanceReviewer(),
		),
	);
} catch (error) {
	if (error instanceof AcceptanceReviewNoResult)
		fail(`contingency produced no result: ${error.message}`);
	throw error;
}
const { verdict, contingency } = resolved;

const record = {
	protocolVersion: 2,
	ticket: prepared.manifest.ticket,
	profile: "questpie.acceptance.v2",
	manifestPath: prepared.manifestPath,
	reviewedHead: head,
	diffBase: prepared.manifest.diffBase,
	packetDigest: prepared.packetDigest,
	primary: { profile: "claude-opus-medium-v1", ...primary },
	...(contingency ? { contingency } : {}),
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
