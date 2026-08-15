import { loadRevision, validateRevision } from "./check";

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
		value.projectionPatches.authorityAndGuidance!.sha256 = "c".repeat(64);
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

console.log(`BETA-04 authority negative controls: ${invalid.length} rejected`);
