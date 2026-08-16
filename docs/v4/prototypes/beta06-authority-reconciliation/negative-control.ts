import { loadRevision, validateRevision } from "./check";

const source = loadRevision();
const clone = () => structuredClone(source);
const invalid = [
	() => {
		const value = clone();
		value.projectionBase = "a".repeat(40);
		return value;
	},
	() => {
		const value = clone();
		value.authorityHeads.P4 = "b".repeat(40);
		return value;
	},
	() => {
		const value = clone();
		value.ownership.beta06Required = "committed change fact";
		return value;
	},
	() => {
		const value = clone();
		value.ownership.captureOwner = "Mutation Runtime";
		return value;
	},
	() => {
		const value = clone();
		value.projectionPaths.push("packages/runtime/src/change-ledger.ts");
		return value;
	},
	() => {
		const value = clone();
		value.nonGoals = value.nonGoals.filter(
			(nonGoal) => nonGoal !== "BETA-07 readiness",
		);
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
	if (!rejected) throw new Error("invalid reconciliation was accepted");
}

console.log(
	`BETA-06 authority reconciliation negative controls: ${invalid.length} rejected`,
);
