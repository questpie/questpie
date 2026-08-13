import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const fixture = mkdtempSync(resolve(".knip-negative-control-"));

try {
	writeFileSync(
		resolve(fixture, "package.json"),
		JSON.stringify({
			name: "@questpie/knip-negative-control",
			private: true,
			scripts: {
				invalid: "undeclared-questpie-binary",
				start: "bun index.ts",
			},
		}),
	);
	writeFileSync(
		resolve(fixture, "index.ts"),
		'import dependency from "installed-but-unlisted";\nconsole.log(dependency);\n',
	);
	const installed = resolve(fixture, "node_modules", "installed-but-unlisted");
	mkdirSync(installed, { recursive: true });
	writeFileSync(
		resolve(installed, "package.json"),
		JSON.stringify({ name: "installed-but-unlisted", version: "1.0.0" }),
	);
	writeFileSync(resolve(installed, "index.js"), "export default true;\n");
	writeFileSync(
		resolve(fixture, "knip.json"),
		JSON.stringify({
			entry: ["index.ts!"],
			project: ["index.ts!"],
			rules: { unlisted: "error", binaries: "error" },
		}),
	);

	const result = Bun.spawnSync(
		[
			resolve("node_modules/.bin/knip"),
			"--include",
			"unlisted,binaries",
			"--reporter",
			"compact",
		],
		{ cwd: fixture, stdout: "pipe", stderr: "pipe" },
	);
	const report = `${result.stdout.toString()}\n${result.stderr.toString()}`;
	if (
		result.exitCode === 0 ||
		!report.includes("installed-but-unlisted") ||
		!report.includes("undeclared-questpie-binary")
	) {
		console.error(report);
		throw new Error("Knip did not reject both deliberate negative controls");
	}
	console.log("knip negative control: unlisted dependency and binary rejected");
} finally {
	rmSync(fixture, { recursive: true, force: true });
}
