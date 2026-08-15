import { loadQueue, validate } from "./check";

const source = loadQueue();
const clone = () => structuredClone(source);
const at = (value: typeof source, index: number) => {
	const issue = value.issues[index];
	if (!issue) throw new Error(`missing negative-control issue ${index}`);
	return issue;
};
const invalid = [
	() => {
		const value = clone();
		value.authorityHeads.P15 = "short";
		return value;
	},
	() => {
		const value = clone();
		at(value, 1).blockedBy = ["BETA-12"];
		return value;
	},
	() => {
		const value = clone();
		delete value.acceptedIssues["BETA-03"];
		return value;
	},
	() => {
		const value = clone();
		delete value.acceptedIssues["BETA-02"];
		return value;
	},
	() => {
		const value = clone();
		value.acceptedIssues["BETA-13"] = "a".repeat(40);
		return value;
	},
	() => {
		const value = clone();
		value.acceptedIssues["BETA-03"] = "short";
		return value;
	},
	() => {
		const value = clone();
		at(value, 3).agentReady = true;
		return value;
	},
	() => {
		const value = clone();
		at(value, 5).redTest = "";
		return value;
	},
	() => {
		const value = clone();
		at(value, 7).hostile = [];
		return value;
	},
	() => {
		const value = clone();
		at(value, 9).budgets = ["fast enough"];
		return value;
	},
	() => {
		const value = clone();
		at(value, 10).fixture = "generic fixture";
		return value;
	},
	() => {
		const value = clone();
		at(value, 11).verify = ["bun test"];
		return value;
	},
	() => {
		const value = clone();
		at(value, 3).performance.evidence = [];
		return value;
	},
	() => {
		const value = clone();
		at(value, 4).artifacts.push("raw Route implementation");
		return value;
	},
	() => {
		const value = clone();
		at(value, 5).verify = at(value, 5).verify.filter(
			(command) => !command.includes("bench:micro"),
		);
		return value;
	},
];

for (const mutate of invalid) {
	let rejected = false;
	try {
		validate(mutate());
	} catch {
		rejected = true;
	}
	if (!rejected) throw new Error("invalid implementation queue was accepted");
}

console.log(`P16 negative controls: ${invalid.length} invalid queues rejected`);
