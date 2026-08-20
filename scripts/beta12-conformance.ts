import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type Target = "local" | "managed";

function fail(message: string, exitCode = 1): never {
	console.error(`beta12-conformance: ${message}`);
	process.exit(exitCode);
}

function value(flag: string): string | undefined {
	const index = Bun.argv.indexOf(flag);
	return index === -1 ? undefined : Bun.argv[index + 1];
}

const target = value("--target") as Target | undefined;
const reportPath = value("--report");
if ((target !== "local" && target !== "managed") || !reportPath)
	fail("use --target local|managed --report <path>");

const write = (report: Readonly<Record<string, unknown>>): void => {
	const path = resolve(reportPath);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(report, null, "\t")}\n`);
};

const required = ["PGHOST", "PGDATABASE", "PGUSER"] as const;
const missing = required.filter((name) => !process.env[name]);
if (target === "managed" && !process.env.PGPASSWORD) missing.push("PGPASSWORD");
if (missing.length > 0) {
	write({
		format: "questpie.beta12-conformance",
		version: 1,
		target,
		profile:
			target === "managed" ? "supabase-postgresql" : "local-postgresql-17",
		status: "WITHHELD",
		reason:
			target === "managed" ? "MISSING_CREDENTIAL" : "MISSING_CONFIGURATION",
		missing,
	});
	fail(`${target} evidence WITHHELD: ${missing.join(", ")}`, 2);
}

const result = Bun.spawnSync(
	["bun", "run", "test:postgres", "--", "--scenario", "beta12"],
	{
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	},
);
if (result.exitCode !== 0) {
	write({
		format: "questpie.beta12-conformance",
		version: 1,
		target,
		status: "FAIL",
		reason: "CONFORMANCE_FAILED",
	});
	fail(`${target} conformance failed`);
}

write({
	format: "questpie.beta12-conformance",
	version: 1,
	target,
	profile: target === "managed" ? "supabase-postgresql" : "local-postgresql-17",
	status: "PASS",
	postgresMajor: process.env.QUESTPIE_POSTGRES_MAJOR ?? "unreported",
	fixtureTracers: ["collaboration", "archive"],
	packageShape: "questpie-4.0.0-beta.1.tgz",
});
console.log(`beta12-conformance: ${target} PASS`);
