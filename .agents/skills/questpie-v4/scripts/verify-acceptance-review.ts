import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";

import { findAcceptancePacketSecret } from "./acceptance-packet-secrets";
import {
	AcceptancePacketError,
	prepareAcceptancePacket,
} from "./acceptance-review-packet";
import {
	AcceptanceRecordError,
	decodeAcceptanceReviewRecord,
} from "./acceptance-review-record";

function fail(message: string): never {
	console.error(`acceptance review verification: ${message}`);
	process.exit(1);
}

function checkedPath(path: string): string {
	if (
		!path ||
		isAbsolute(path) ||
		normalize(path) !== path ||
		path === ".." ||
		path.startsWith("../")
	)
		fail("record must be a normalized repository-relative path");
	try {
		if (!lstatSync(path).isFile()) fail("record is not a regular file");
	} catch {
		fail("record does not exist");
	}
	return path;
}

function shell(args: string[]): string {
	const process = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
	if (process.exitCode !== 0)
		fail(`${args.join(" ")} failed: ${process.stderr.toString().trim()}`);
	return process.stdout.toString();
}

const argv = Bun.argv.slice(2);
if (argv.length !== 2 || argv[0] !== "--record")
	fail("require exactly --record <path>");
const recordPath = checkedPath(argv[1]!);
const trackedRecord = shell(["git", "show", `HEAD:${recordPath}`]);
const localRecord = readFileSync(recordPath, "utf8");
if (trackedRecord !== localRecord) fail("record differs from committed HEAD");

let raw: unknown;
try {
	raw = JSON.parse(localRecord);
} catch (error) {
	fail(`invalid record JSON: ${String(error)}`);
}
if (
	typeof raw !== "object" ||
	raw === null ||
	Array.isArray(raw) ||
	typeof (raw as Record<string, unknown>).reviewedHead !== "string" ||
	typeof (raw as Record<string, unknown>).manifestPath !== "string"
)
	fail("record lacks reviewedHead or manifestPath");
const reviewedHead = (raw as Record<string, string>).reviewedHead;
const manifestPath = (raw as Record<string, string>).manifestPath;
shell(["git", "merge-base", "--is-ancestor", reviewedHead, "HEAD"]);

let prepared: ReturnType<typeof prepareAcceptancePacket>;
try {
	prepared = prepareAcceptancePacket({ manifestPath, reviewedHead });
} catch (error) {
	if (error instanceof AcceptancePacketError) fail(error.message);
	throw error;
}
if (prepared.manifest.reviewOutput !== recordPath)
	fail("manifest review output does not match the committed record path");
try {
	decodeAcceptanceReviewRecord(raw, {
		ticket: prepared.manifest.ticket,
		manifestPath,
		reviewedHead,
		diffBase: prepared.manifest.diffBase,
		packetDigest: prepared.packetDigest,
	});
} catch (error) {
	if (error instanceof AcceptanceRecordError) fail(error.message);
	throw error;
}
const secret = findAcceptancePacketSecret(localRecord);
if (secret) fail(`record contains a prohibited ${secret.name}`);
console.log(
	`acceptance review verification PASS: ${recordPath} -> ${reviewedHead}`,
);
