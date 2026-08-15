import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
	loadRevision,
	validateProjectionPatch,
	validateRevision,
} from "./check";

const source = await loadRevision();
const clone = () => structuredClone(source);
const invalid = [
	() => {
		const value = clone();
		value.originalP2.proofHead = "a".repeat(40);
		return value;
	},
	() => {
		const value = clone();
		value.originalP2.messagePolicyProgramDigest = "b".repeat(64);
		return value;
	},
	() => {
		const value = clone();
		value.cursor.policyProtectedVersion = 1;
		return value;
	},
	() => {
		const value = clone();
		value.cursor.usedExecutionFacts = ["authorityKind", "contextRole"];
		return value;
	},
	() => {
		const value = clone();
		value.cursor.validationOrder = ["sql", "shape"];
		return value;
	},
	() => {
		const value = clone();
		value.policyDiagnostics.push({
			code: "QP-POLICY-003",
			class: "unlowerablePolicy",
			phase: "compile",
			blocking: "fatal",
		});
		return value;
	},
	() => {
		const value = clone();
		delete value.acceptedIssues["BETA-03"];
		return value;
	},
	() => {
		const value = clone();
		value.readyIssue = "BETA-05";
		return value;
	},
	() => {
		const value = clone();
		value.projectionPatches[0]!.sha256 = "c".repeat(64);
		return value;
	},
];

for (const mutate of invalid) {
	let rejected = false;
	try {
		validateRevision(mutate());
	} catch {
		rejected = true;
	}
	if (!rejected) throw new Error("invalid authority revision was accepted");
}

const patch = source.projectionPatches[0]!;
const bytes = Buffer.from(
	await readFile(resolve(import.meta.dir, patch.path), "utf8"),
	"base64",
);
const changed = Buffer.from(bytes);
changed[0] = changed[0]! ^ 1;
let changedPatchRejected = false;
try {
	validateProjectionPatch(patch, changed);
} catch {
	changedPatchRejected = true;
}
if (!changedPatchRejected)
	throw new Error("changed projection bytes were accepted");

const outOfScope = Buffer.from(
	bytes
		.toString()
		.replace(
			"apps/docs/content/docs/v4/context-and-policy.mdx",
			"packages/runtime/src/context-and-policy.ts",
		),
);
let outOfScopeRejected = false;
try {
	validateProjectionPatch(
		{
			...patch,
			sha256: createHash("sha256").update(outOfScope).digest("hex"),
		},
		outOfScope,
	);
} catch {
	outOfScopeRejected = true;
}
if (!outOfScopeRejected)
	throw new Error("out-of-scope projection was accepted");

console.log(
	`BETA-04 authority negative controls: ${invalid.length + 2} rejected`,
);
