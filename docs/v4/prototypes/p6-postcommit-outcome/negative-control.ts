import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
	assertExecutableSemantics,
	decodeCommittedFailure,
	validateRevision,
	validateWireV2,
} from "./check";

const revision = JSON.parse(
	await readFile(join(import.meta.dir, "REVISION.json"), "utf8"),
);
const wire = JSON.parse(
	await readFile(join(import.meta.dir, "wire-v2.json"), "utf8"),
);

function clone<T>(value: T): T {
	return structuredClone(value);
}

function mustReject(name: string, run: () => unknown): void {
	try {
		run();
	} catch {
		return;
	}
	throw new Error(`negative control did not reject ${name}`);
}

for (const [name, mutate] of [
	["wire version", (value: any) => (value.version = 1)],
	["failure code", (value: any) => value.failures.splice(2, 1)],
	[
		"status",
		(value: any) => (value.committedResultUnavailable.httpStatus = 409),
	],
	[
		"retryability",
		(value: any) => (value.committedResultUnavailable.retryable = false),
	],
	["automatic retry", (value: any) => (value.mutationAutomaticRetry = true)],
	[
		"failure detail",
		(value: any) => value.failureDetails.committedResultUnavailable.pop(),
	],
	[
		"UUID-only call identity",
		(value: any) => (value.callIdentity.uuidRequired = true),
	],
	[
		"normalizing input",
		(value: any) => (value.callIdentity.normalizationBehavior = "rewrite"),
	],
	[
		"code-unit bound",
		(value: any) => (value.callIdentity.maximumUnicodeScalars = 128),
	],
	[
		"wire v1 mutation execution",
		(value: any) => (value.compatibility.wireV1MutationExecution = "execute"),
	],
	[
		"retained v1 result",
		(value: any) =>
			(value.compatibility.retainedV1ResultCompatibility = "allowed"),
	],
] as const) {
	const candidate = clone(wire);
	mutate(candidate);
	mustReject(name, () => validateWireV2(candidate));
}

for (const [name, mutate] of [
	["P6 head", (value: any) => (value.originalP6.proofHead = "0".repeat(40))],
	["P6 digest", (value: any) => (value.originalP6.wireDigest = "0".repeat(64))],
	[
		"projection commit",
		(value: any) => (value.projection.commit = "0".repeat(40)),
	],
	[
		"projection digest",
		(value: any) => (value.projection.diffSha256 = "0".repeat(64)),
	],
] as const) {
	const candidate = clone(revision);
	mutate(candidate);
	mustReject(name, () => validateRevision(candidate));
}

const validFrame = {
	protocol: { name: "questpie.operation", version: 1 },
	kind: "failure",
	operation: "mutation:messages.submit",
	callId: "call-lost",
	error: {
		code: "COMMITTED_RESULT_UNAVAILABLE",
		retryable: true,
		transactionId: "901",
	},
};
for (const [name, mutate] of [
	["extra frame key", (value: any) => (value.outcome = "committed")],
	["extra error key", (value: any) => (value.error.detail = "secret")],
	["wrong correlation", (value: any) => (value.callId = "other")],
	["wrong status", (_value: any) => undefined],
	["zero xid8", (value: any) => (value.error.transactionId = "0")],
] as const) {
	const candidate = clone(validFrame);
	mutate(candidate);
	mustReject(name, () =>
		decodeCommittedFailure(
			candidate,
			name === "wrong status" ? 409 : 500,
			"call-lost",
		),
	);
}

assertExecutableSemantics();
console.log("P6R1 post-commit negative controls PASS (20 branches)");
