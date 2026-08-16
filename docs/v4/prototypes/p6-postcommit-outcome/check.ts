import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

const root = resolve(import.meta.dir, "../../../..");
const exact = {
	base: "f0565bfbff5fe33c99f81d1d721e828cfc421dc8",
	p6: "94c237c9aa910a60a332b1ef97473f34fe89d65b",
	p6WireBlob: "22dd964052690579b606dfe0d2f97c264809aa7b",
	p6WireSourceSha256:
		"82651aa7fd3697050792c40e3cd24a167eeb097652c3f9041cedb0a2b4051017",
	p6WireDigest:
		"d9c28927d2ced07aaecc8d2cd8caf0f94327232b33d8466535642c2af1c9115c",
	projection: "823d199efd8658a1c896056c2b9ae9da622de173",
	projectionParent: "e8105b25534d99441c4beea6f3357cf1bf9001f8",
	projectionRevert: "64e7cf11fd74e4db02943e70e28667cd0914df92",
	reviewedHead: "deea51ba2799867825b120ec46ec5d8944991d1b",
	reviewEvidence: "cb568dc402462163d632a2d689da709a087f64ae",
	projectionReapplication: "d5bf7d0adadcda0f5b932e6b1a7c20df0e4102a6",
	projectionSha256:
		"9f82a90a2fe17bf764aa0bec4e8c8844d2254ba30c25a6b4337cb307596dc108",
} as const;

const allowedProjectionPaths = [
	"apps/docs/content/docs/v4/queries-and-mutations.mdx",
	"apps/docs/content/docs/v4/runtime-and-studio.mdx",
	"docs/adr/0014-freeze-runtime-client-envelope-and-minimal-studio.md",
	"docs/adr/0023-freeze-post-commit-operation-outcome.md",
	"docs/adr/README.md",
	"docs/v4/implementation/beta06/design-context.md",
	"docs/v4/query-mutation-and-lifecycle.md",
	"docs/v4/runtime-client-envelope-and-studio.md",
] as const;

function record(value: unknown, name: string): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${name} must be an object`);
	return value as JsonRecord;
}

function equal(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function exactKeys(
	value: JsonRecord,
	keys: readonly string[],
	name: string,
): void {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (!equal(actual, expected)) throw new Error(`${name} keys changed`);
}

function assertSetSize(
	value: ReadonlySet<unknown>,
	size: number,
	name: string,
): void {
	if (value.size !== size) throw new Error(`${name} size changed`);
}

const compareAscii = (left: string, right: string) =>
	left < right ? -1 : left > right ? 1 : 0;

function canonicalValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.keys(value as JsonRecord)
				.sort(compareAscii)
				.map((key) => [key, canonicalValue((value as JsonRecord)[key])]),
		);
	return value;
}

function canonicalDigest(domain: string, value: unknown): string {
	return createHash("sha256")
		.update(domain)
		.update(`${JSON.stringify(canonicalValue(value))}\n`)
		.digest("hex");
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

function commandBytesWithInput(
	args: string[],
	input: Uint8Array,
	cwd = root,
): Buffer {
	const result = Bun.spawnSync(args, {
		cwd,
		stdin: input,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0)
		throw new Error(
			`${args.join(" ")} failed: ${result.stderr.toString().trim()}`,
		);
	return Buffer.from(result.stdout);
}

function hasLoneSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const low = value.charCodeAt(index + 1);
			if (!Number.isFinite(low) || low < 0xdc00 || low > 0xdfff) return true;
			index += 1;
		} else if (code >= 0xdc00 && code <= 0xdfff) return true;
	}
	return false;
}

export function isCallIdentity(value: unknown): value is string {
	return (
		typeof value === "string" &&
		!hasLoneSurrogate(value) &&
		!value.includes("\u0000") &&
		value === value.normalize("NFC") &&
		[...value].length >= 1 &&
		[...value].length <= 256 &&
		Buffer.byteLength(value, "utf8") <= 1024
	);
}

export function isTransactionIdentity(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^[1-9][0-9]{0,19}$/.test(value) &&
		BigInt(value) <= 18_446_744_073_709_551_615n
	);
}

export function validateWireV2(value: unknown): string {
	const wire = record(value, "wire v2");
	exactKeys(
		wire,
		[
			"artifact",
			"version",
			"carrier",
			"path",
			"request",
			"response",
			"declaredErrors",
			"resultKinds",
			"failureDetails",
			"failures",
			"committedResultUnavailable",
			"callIdentity",
			"transactionIdentity",
			"clientCarrier",
			"compatibility",
			"limits",
			"principalSource",
			"mutationAutomaticRetry",
		],
		"wire v2",
	);
	if (wire.artifact !== "questpie.operation-wire" || wire.version !== 2)
		throw new Error("wire v2 identity changed");
	const carrier = record(wire.carrier, "carrier");
	if (
		!equal(carrier.protocol, { name: "questpie.operation", version: 1 }) ||
		carrier.mediaType !== "application/vnd.questpie.operation+json;version=1" ||
		carrier.exactContractSelector !== "wireDigest"
	)
		throw new Error("carrier compatibility changed");
	if (wire.path !== "/_questpie/operation")
		throw new Error("wire path changed");
	if (
		!equal(wire.request, [
			"application",
			"callId",
			"clientContractDigest",
			"context",
			"input",
			"operation",
			"protocol",
			"timeoutMilliseconds",
			"wireDigest",
		]) ||
		!equal(wire.response, {
			result: ["callId", "kind", "operation", "payload", "protocol"],
			declaredError: ["callId", "error", "kind", "operation", "protocol"],
			failure: ["callId", "error", "kind", "operation", "protocol"],
			rejection: ["error", "kind"],
		})
	)
		throw new Error("wire frame keys changed");
	if (
		!equal(wire.declaredErrors, {
			"mutation:messages.submit": {
				IDEMPOTENCY_CONFLICT: { status: 409, payload: ["callId"] },
			},
			"query:archives.record": {},
			"query:channels.overview": {},
		}) ||
		!equal(wire.resultKinds, ["declaredError", "failure", "result"])
	)
		throw new Error("v1 result or declared-error continuity changed");
	if (
		!equal(wire.failureDetails, {
			ordinary: ["code", "retryable"],
			committedResultUnavailable: ["code", "retryable", "transactionId"],
		})
	)
		throw new Error("failure detail changed");
	if (
		!equal(wire.failures, [
			"APPLICATION_MISMATCH",
			"CLIENT_OUTDATED",
			"COMMITTED_RESULT_UNAVAILABLE",
			"DEADLINE_EXCEEDED",
			"INTERNAL",
			"NOT_FOUND",
			"PROTOCOL_UNSUPPORTED",
			"RESOURCE_LIMIT",
			"RUNTIME_UNAVAILABLE",
		])
	)
		throw new Error("closed failure set changed");
	if (
		!equal(wire.committedResultUnavailable, {
			classification: "frameworkTransactionOutcome",
			httpStatus: 500,
			retryable: true,
			transactionOutcome: "committed",
			automaticRetry: false,
			recovery: "replayExactMutationWithSameCallIdentity",
			frameCallIdSource: "acceptedRequest",
			transactionIdSource: "committedReceipt",
			causeDisclosure: "forbidden",
		})
	)
		throw new Error("post-commit outcome changed");
	if (
		!equal(wire.callIdentity, {
			kind: "text",
			minimumUnicodeScalars: 1,
			maximumUnicodeScalars: 256,
			maximumUtf8Bytes: 1024,
			normalization: "NFC",
			normalizationBehavior: "rejectNotRewrite",
			loneSurrogates: "forbidden",
			nullScalar: "forbidden",
			uuidRequired: false,
			runtimeDefaultWhenAbsent: "crypto.randomUUID",
			equality: "exactUtf8AfterValidation",
		})
	)
		throw new Error("Call Identity changed");
	if (
		!equal(wire.transactionIdentity, {
			kind: "postgresXid8Text",
			canonicalPattern: "^[1-9][0-9]{0,19}$",
			maximum: "18446744073709551615",
			clientInterpretation: "opaque",
		})
	)
		throw new Error("transaction identity changed");
	if (
		!equal(wire.clientCarrier, {
			name: "CommittedResultUnavailable",
			code: "COMMITTED_RESULT_UNAVAILABLE",
			retryable: true,
			payload: ["callId", "transactionId"],
			payloadFrozen: true,
			constructorIdentityAcrossServerAndClient: "notPromised",
		})
	)
		throw new Error("client carrier changed");
	if (
		!equal(wire.compatibility, {
			wireV1Bytes: "preserved",
			wireV1Digest: exact.p6WireDigest,
			wireV1MutationExecution: "rejectBeforeContextAndOperation",
			wireV1QueryExecution: "allowedWhenCurrentOrRetainedPair",
			wireV1RejectionCode: "CLIENT_OUTDATED",
			wireV1RejectionFrame: "wireV1CompatibleUncorrelatedFailure",
			retainedV1ResultCompatibility: "queryOnly",
		}) ||
		!equal(wire.limits, {
			requestBytes: 1_048_576,
			responseBytes: 1_048_576,
		}) ||
		wire.principalSource !== "credentialResolverOutsideBody" ||
		wire.mutationAutomaticRetry !== false
	)
		throw new Error("wire compatibility or limits changed");
	return canonicalDigest("questpie:p6:wireProjection:v2\n", wire);
}

const protocol = Object.freeze({ name: "questpie.operation", version: 1 });

export function committedFailureFrame(callId: string, transactionId: string) {
	if (!isCallIdentity(callId) || !isTransactionIdentity(transactionId))
		throw new Error("invalid recovery identity");
	return Object.freeze({
		protocol,
		kind: "failure" as const,
		operation: "mutation:messages.submit",
		callId,
		error: Object.freeze({
			code: "COMMITTED_RESULT_UNAVAILABLE" as const,
			retryable: true as const,
			transactionId,
		}),
	});
}

export function decodeCommittedFailure(
	value: unknown,
	status: number,
	expectedCallId: string,
) {
	const frame = record(value, "committed failure frame");
	exactKeys(
		frame,
		["callId", "error", "kind", "operation", "protocol"],
		"committed failure frame",
	);
	const error = record(frame.error, "committed failure detail");
	exactKeys(
		error,
		["code", "retryable", "transactionId"],
		"committed failure detail",
	);
	if (
		status !== 500 ||
		frame.kind !== "failure" ||
		frame.operation !== "mutation:messages.submit" ||
		!isCallIdentity(expectedCallId) ||
		!isCallIdentity(frame.callId) ||
		frame.callId !== expectedCallId ||
		!equal(frame.protocol, protocol) ||
		error.code !== "COMMITTED_RESULT_UNAVAILABLE" ||
		error.retryable !== true ||
		!isTransactionIdentity(error.transactionId)
	)
		throw new Error("committed failure is invalid");
	const payload = Object.freeze({
		callId: expectedCallId,
		transactionId: error.transactionId,
	});
	return Object.freeze({
		name: "CommittedResultUnavailable" as const,
		code: "COMMITTED_RESULT_UNAVAILABLE" as const,
		retryable: true as const,
		payload,
	});
}

export function assertExecutableSemantics(): void {
	for (const accepted of [
		"call-lost",
		"call:wire-matrix",
		"é",
		"😀".repeat(256),
	])
		if (!isCallIdentity(accepted))
			throw new Error(`valid Call Identity rejected: ${accepted}`);
	for (const rejected of [
		"",
		"a".repeat(257),
		"😀".repeat(257),
		"e\u0301",
		"bad\u0000id",
		"\ud800",
		"\udc00",
	])
		if (isCallIdentity(rejected))
			throw new Error("invalid Call Identity accepted");
	for (const accepted of ["1", "901", "18446744073709551615"])
		if (!isTransactionIdentity(accepted))
			throw new Error("valid xid8 rejected");
	for (const rejected of ["0", "01", "-1", "18446744073709551616", "tx-1"])
		if (isTransactionIdentity(rejected))
			throw new Error("invalid xid8 accepted");

	const frame = committedFailureFrame("call-lost", "901");
	const carrier = decodeCommittedFailure(frame, 500, "call-lost");
	if (
		!Object.isFrozen(frame) ||
		!Object.isFrozen(frame.error) ||
		!Object.isFrozen(carrier) ||
		!Object.isFrozen(carrier.payload) ||
		!equal(carrier.payload, { callId: "call-lost", transactionId: "901" })
	)
		throw new Error("recovery carrier is mutable or incomplete");

	const operationExecutions = new Set<string>();
	const receipts = new Map<string, string>();
	const invoke = (callId: string, loseResponse: boolean) => {
		const key = `application:collaboration\0tenant:1\0mutation:messages.submit\0user:1\0${callId}`;
		const prior = receipts.get(key);
		if (prior !== undefined) return prior;
		operationExecutions.add(key);
		const bytes = '{"id":"message:1"}\n';
		receipts.set(key, bytes);
		if (loseResponse) throw committedFailureFrame(callId, "901");
		return bytes;
	};
	let lost: unknown;
	try {
		invoke("call-lost", true);
	} catch (error) {
		lost = error;
	}
	decodeCommittedFailure(lost, 500, "call-lost");
	if (invoke("call-lost", false) !== '{"id":"message:1"}\n')
		throw new Error("exact replay did not recover the committed receipt");
	assertSetSize(operationExecutions, 1, "Mutation execution");
}

export function validateRevision(value: unknown): void {
	const revision = record(value, "revision");
	if (
		revision.format !== "questpie.p6-postcommit-outcome-revision" ||
		revision.version !== 1 ||
		revision.identity !== "P6R1/PostCommitOutcome" ||
		revision.projectionBase !== exact.base
	)
		throw new Error("revision identity changed");
	if (
		!equal(revision.originalP6, {
			status: "preserved",
			proofHead: exact.p6,
			wireSourceBlob: exact.p6WireBlob,
			wireSourceSha256: exact.p6WireSourceSha256,
			wireDigest: exact.p6WireDigest,
		}) ||
		!equal(revision.artifacts, {
			p6WireSource: "P6-GOLDENS.mjs.b64",
			wireV1: "wire-v1.json",
			wireV2: "wire-v2.json",
			wireV2Digest:
				"2f4cd0631be02ff8a979a0aaa22d0fd393d3638db55e4cc9bbb2db6d9a5ade28",
		}) ||
		!equal(revision.projection, {
			commit: exact.projection,
			parent: exact.projectionParent,
			revertedBy: exact.projectionRevert,
			path: "PROJECTION.patch.b64",
			encoding: "base64",
			diffSha256: exact.projectionSha256,
		})
	)
		throw new Error("revision evidence changed");
	for (const required of [
		"production Runtime implementation",
		"automatic Mutation retry",
		"authored declared error",
		"wire v1 reinterpretation",
		"provider or host adapter",
		"PostgreSQL schema change",
	])
		if (!(revision.nonGoals as unknown[])?.includes(required))
			throw new Error(`missing non-goal ${required}`);
}

async function verifyRepositoryEvidence(): Promise<void> {
	const source = Buffer.from(
		await readFile(join(import.meta.dir, "P6-GOLDENS.mjs.b64"), "utf8"),
		"base64",
	);
	if (
		createHash("sha256").update(source).digest("hex") !==
		exact.p6WireSourceSha256
	)
		throw new Error("portable Accepted P6 wire source bytes changed");
	for (const commit of [
		exact.projection,
		exact.projectionRevert,
		exact.reviewedHead,
		exact.reviewEvidence,
		exact.projectionReapplication,
	])
		command(["git", "merge-base", "--is-ancestor", commit, "HEAD"]);
	if (
		command(["git", "rev-parse", `${exact.projection}^`]) !==
		exact.projectionParent
	)
		throw new Error("projection parent changed");
	const projection = commandBytes([
		"git",
		"-c",
		"core.abbrev=40",
		"-c",
		"diff.noprefix=false",
		"-c",
		"diff.algorithm=myers",
		"-c",
		"diff.context=3",
		"show",
		"--format=",
		"--binary",
		exact.projection,
	]);
	if (
		createHash("sha256").update(projection).digest("hex") !==
		exact.projectionSha256
	)
		throw new Error("projection bytes changed");
	const portableProjection = Buffer.from(
		await readFile(join(import.meta.dir, "PROJECTION.patch.b64"), "utf8"),
		"base64",
	);
	if (!projection.equals(portableProjection))
		throw new Error("portable projection does not equal retained commit bytes");
	if (
		command(["git", "rev-parse", `${exact.projectionReapplication}^`]) !==
		exact.reviewEvidence
	)
		throw new Error("accepted projection reapplication parent changed");
	const reapplication = commandBytes([
		"git",
		"-c",
		"core.abbrev=40",
		"-c",
		"diff.noprefix=false",
		"-c",
		"diff.algorithm=myers",
		"-c",
		"diff.context=3",
		"show",
		"--format=",
		"--binary",
		exact.projectionReapplication,
	]);
	if (!reapplication.equals(portableProjection))
		throw new Error("accepted projection was not reapplied byte-for-byte");
	command([
		"git",
		"diff",
		"--quiet",
		exact.projectionReapplication,
		"HEAD",
		"--",
		...allowedProjectionPaths,
	]);
	if (
		commandBytesWithInput(["git", "hash-object", "--stdin"], source)
			.toString()
			.trim() !== exact.p6WireBlob
	)
		throw new Error("portable Accepted P6 source blob identity changed");
	const paths = command([
		"git",
		"diff-tree",
		"--no-commit-id",
		"--name-only",
		"-r",
		exact.projection,
	])
		.split("\n")
		.filter(Boolean);
	if (!equal(paths, allowedProjectionPaths))
		throw new Error("projection scope changed");
	if (
		command([
			"git",
			"show",
			`${exact.projectionRevert}:docs/adr/README.md`,
		]).includes("ADR-0023")
	)
		throw new Error("candidate projection was not reverted before review");

	const temporary = mkdtempSync(join(tmpdir(), "questpie-p6r1-"));
	try {
		command([
			"git",
			"worktree",
			"add",
			"--detach",
			temporary,
			exact.projectionParent,
		]);
		const apply = Bun.spawnSync(["git", "apply", "--check", "-"], {
			cwd: temporary,
			stdin: portableProjection,
			stdout: "pipe",
			stderr: "pipe",
		});
		if (apply.exitCode !== 0)
			throw new Error(
				`portable projection failed: ${apply.stderr.toString().trim()}`,
			);
	} finally {
		Bun.spawnSync(["git", "worktree", "remove", "--force", temporary], {
			cwd: root,
		});
		await rm(temporary, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	const revision = JSON.parse(
		await readFile(join(import.meta.dir, "REVISION.json"), "utf8"),
	);
	const wireV1 = JSON.parse(
		await readFile(join(import.meta.dir, "wire-v1.json"), "utf8"),
	);
	const wireV2 = JSON.parse(
		await readFile(join(import.meta.dir, "wire-v2.json"), "utf8"),
	);
	validateRevision(revision);
	if (
		canonicalDigest("questpie:p6:wireProjection:v1\n", wireV1) !==
		exact.p6WireDigest
	)
		throw new Error("Operation Wire v1 bytes or digest changed");
	const wireV2Digest = validateWireV2(wireV2);
	if (
		wireV2Digest !==
		record(revision.artifacts, "revision artifacts").wireV2Digest
	)
		throw new Error("Operation Wire v2 digest changed");
	assertExecutableSemantics();
	await verifyRepositoryEvidence();
	console.log(`P6R1 post-commit outcome PASS; wireV2Digest=${wireV2Digest}`);
}

if (import.meta.main) await main();
