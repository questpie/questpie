import { readFileSync } from "node:fs";

import { validate } from "./check";

const source = readFileSync(new URL("./MATRIX.md", import.meta.url), "utf8");
const cases: Array<[string, (value: string) => string]> = [
	["missing row", (value) => value.replace(/^\| channel\s+\|.*\n/m, "")],
	[
		"empty column",
		(value) => value.replace(/\| compiler\s+\| both/, "|  | both"),
	],
	["single domain", (value) => value.replaceAll("| both", "| collaboration")],
	["optional authority", (value) => `${value}\nCache owns Policy authority.\n`],
	["RLS claim", (value) => `${value}\nRLS guarantees authorization.\n`],
];

for (const [name, mutate] of cases) {
	let rejected = false;
	try {
		validate(mutate(source));
	} catch {
		rejected = true;
	}
	if (!rejected) throw new Error(`negative control passed: ${name}`);
}

console.log(`P14 negative controls: ${cases.length} invalid matrices rejected`);
