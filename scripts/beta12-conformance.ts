import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { SQL } from "bun";

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

const host = process.env.PGHOST as string;
const targetProfile =
	target === "managed" ? "supabase-postgresql" : "local-postgresql";
const localHost = /^(?:127(?:\.[0-9]{1,3}){3}|localhost|::1)$/i.test(host);
const supabaseHost = /(?:^|\.)(?:supabase\.co|supabase\.com)$/i.test(host);
if (
	(target === "local" && !localHost) ||
	(target === "managed" && !supabaseHost)
) {
	write({
		format: "questpie.beta12-conformance",
		version: 1,
		target,
		profile: targetProfile,
		status: "FAIL",
		reason: "TARGET_MISMATCH",
	});
	fail(`${target} target does not match its PostgreSQL host`);
}

const startedAt = performance.now();
const url = new URL("postgres://localhost/");
url.hostname = host;
url.port = process.env.PGPORT ?? "5432";
url.pathname = `/${process.env.PGDATABASE}`;
url.username = process.env.PGUSER as string;
if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
if (process.env.PGSSLMODE)
	url.searchParams.set("sslmode", process.env.PGSSLMODE);
const sql = new SQL(url.href);
let postgresMajor: string;
try {
	const [row] = await sql<Readonly<{ serverVersionNumber: string }>[]>`
		select pg_catalog.current_setting('server_version_num') as "serverVersionNumber"
	`;
	const serverVersionNumber = Number(row?.serverVersionNumber);
	if (!Number.isInteger(serverVersionNumber) || serverVersionNumber < 100_000)
		fail("PostgreSQL returned an invalid server_version_num");
	postgresMajor = String(Math.floor(serverVersionNumber / 10_000));
} finally {
	await sql.close();
}
if (target === "local" && postgresMajor !== "17") {
	write({
		format: "questpie.beta12-conformance",
		version: 1,
		target,
		profile: `${targetProfile}-${postgresMajor}`,
		status: "FAIL",
		reason: "POSTGRES_MAJOR_MISMATCH",
		postgresMajor,
	});
	fail(`local conformance requires PostgreSQL 17, observed ${postgresMajor}`);
}

const profile = `${targetProfile}-${postgresMajor}`;

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
		profile,
		status: "FAIL",
		reason: "CONFORMANCE_FAILED",
		postgresMajor,
		durationMs: Number((performance.now() - startedAt).toFixed(2)),
	});
	fail(`${target} conformance failed`);
}

write({
	format: "questpie.beta12-conformance",
	version: 1,
	target,
	profile,
	status: "PASS",
	postgresMajor,
	fixtureTracers: ["collaboration", "archive"],
	packageShape: "questpie-4.0.0-beta.1.tgz",
	durationMs: Number((performance.now() - startedAt).toFixed(2)),
});
console.log(`beta12-conformance: ${target} PASS`);
