import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

type Kind = "micro" | "load" | "soak";
type Scenario = {
	id: string;
	kind: Kind;
	schedule: "selected-pr" | "nightly" | "manual";
	command: string[];
	budgetOwner: string;
	metrics: Record<
		string,
		{ direction: "max" | "min"; budget: number; unit: string }
	>;
};

function fail(message: string): never {
	console.error(`performance: ${message}`);
	process.exit(1);
}

function manifests(): Scenario[] {
	const root = resolve("quality/performance");
	if (!existsSync(root)) return [];
	return readdirSync(root)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map(
			(name) =>
				JSON.parse(readFileSync(resolve(root, name), "utf8")) as Scenario,
		);
}

function validate(scenario: Scenario): void {
	if (!scenario.id || !["micro", "load", "soak"].includes(scenario.kind))
		fail("invalid scenario identity or kind");
	if (!scenario.budgetOwner || scenario.command.length === 0)
		fail(`${scenario.id} lacks budgetOwner or command`);
	if (Object.keys(scenario.metrics).length === 0)
		fail(`${scenario.id} has no slice-owned metrics`);
	for (const [name, metric] of Object.entries(scenario.metrics)) {
		if (
			!name ||
			!Number.isFinite(metric.budget) ||
			!metric.unit ||
			!["max", "min"].includes(metric.direction)
		) {
			fail(`${scenario.id} has invalid metric ${name}`);
		}
	}
	if (scenario.kind === "micro" && scenario.schedule === "nightly")
		fail(`${scenario.id}: micro belongs on selected PR or manual`);
	if (scenario.kind !== "micro" && scenario.schedule === "selected-pr")
		fail(`${scenario.id}: load/soak cannot enter the ordinary PR path`);
}

const command = Bun.argv[2];
const scenarios = manifests();
for (const scenario of scenarios) validate(scenario);
if (command === "check") {
	console.log(`performance manifests: ${scenarios.length} valid`);
	process.exit(0);
}
const kind = command as Kind;
if (!["micro", "load", "soak"].includes(kind))
	fail("use check, micro, load, or soak");
const selected = scenarios.filter((scenario) => scenario.kind === kind);
if (selected.length === 0) {
	console.log(
		`performance ${kind}: no accepted implementation-slice scenarios yet`,
	);
	process.exit(0);
}
for (const scenario of selected) {
	console.log(`> ${scenario.id}: ${scenario.command.join(" ")}`);
	const result = Bun.spawnSync(scenario.command, {
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	if (result.exitCode !== 0) fail(`${scenario.id} exited ${result.exitCode}`);
}
