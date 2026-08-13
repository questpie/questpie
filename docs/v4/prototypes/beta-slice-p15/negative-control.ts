import { readFileSync } from "node:fs";

import { validate } from "./check";

const source = JSON.parse(
	readFileSync(new URL("./SLICE.json", import.meta.url), "utf8"),
);
const clone = () => structuredClone(source);
const invalid = [
	() => {
		const value = clone();
		value.beta1 = value.beta1.filter(
			(item: { id: string }) => item.id !== "reaction",
		);
		return value;
	},
	() => {
		const value = clone();
		value.beta1[0].requires = ["studio"];
		return value;
	},
	() => {
		const value = clone();
		value.deferred[0].seam = "";
		return value;
	},
	() => {
		const value = clone();
		value.deferred = value.deferred.filter(
			(item: { capability: string }) => item.capability !== "Channel",
		);
		return value;
	},
	() => {
		const value = clone();
		value.releaseGates = [];
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
	if (!rejected) throw new Error("invalid beta slice was accepted");
}
console.log(`P15 negative controls: ${invalid.length} invalid slices rejected`);
