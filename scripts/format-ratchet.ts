import { readFileSync } from "node:fs";

function fail(message: string): never {
	console.error(`format ratchet: ${message}`);
	process.exit(1);
}

const baseline = new Set(
	readFileSync("quality/format-baseline.txt", "utf8")
		.split("\n")
		.filter(Boolean),
);
const result = Bun.spawnSync(["bunx", "oxfmt", "--list-different"], {
	stdout: "pipe",
	stderr: "pipe",
});
const current = result.stdout.toString().split("\n").filter(Boolean).sort();
if (result.exitCode !== 0 && current.length === 0) {
	fail(
		`oxfmt failed without a file report: ${result.stderr.toString().trim()}`,
	);
}
const added = current.filter((path) => !baseline.has(path));
if (added.length > 0) fail(`new formatting drift:\n${added.join("\n")}`);
console.log(
	`format ratchet: ${current.length}/${baseline.size} historical files remain; no new drift`,
);
