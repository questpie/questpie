import { expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

type Step = {
	id?: string;
	name?: string;
	run?: string;
	uses?: string;
	if?: string;
	"continue-on-error"?: boolean;
	env?: Record<string, string>;
	with?: Record<string, unknown>;
};
type ReleaseWorkflow = {
	on: Record<string, unknown>;
	jobs: {
		release: {
			"runs-on": string[];
			env?: Record<string, string>;
			steps: Step[];
			services?: Record<
				string,
				{
					image: string;
					ports: string[];
					env: Record<string, string>;
					options: string;
					volumes?: string[];
				}
			>;
		};
	};
};

const repositoryRoot = resolve(import.meta.dir, "../..");
const workflow = Bun.YAML.parse(
	readFileSync(
		resolve(repositoryRoot, ".github/workflows/release.yml"),
		"utf8",
	),
) as ReleaseWorkflow;

test("publication follows successful execution of the five unchanged release workloads", () => {
	const steps = workflow.jobs.release.steps;
	const quality = steps.findIndex(
		(step) => step.run === "bun run quality:release",
	);
	const workloads = steps.findIndex((step) => step.id === "workloads");
	const publish = steps.findIndex((step) => step.run === "bun run release");
	expect(quality).toBeGreaterThanOrEqual(0);
	expect(workloads).toBeGreaterThan(quality);
	expect(publish).toBeGreaterThan(workloads);
	const owner = steps[workloads]!;
	expect(owner.if).toBeUndefined();
	expect(owner["continue-on-error"]).toBeUndefined();
	expect(owner.run).toContain("set -euo pipefail");
	const commands = owner
		.run!.split("\n")
		.filter((line) => /^bun run (test:load|test:soak|bench:micro) /.test(line))
		.map((line) => line.split(" 2>&1")[0]);
	expect(commands).toEqual([
		"bun run test:load -- --scenario beta08-worker-contention",
		"bun run test:load -- --scenario beta10-ten-instance",
		"bun run test:load -- --scenario pb05-mutation-transaction-tail",
		"bun run test:soak -- --scenario beta10-soak-chaos",
		"bun run bench:micro -- --scenario beta12-release-gate",
	]);
});

test("workloads target only the job-owned disk-backed PostgreSQL 17 service", () => {
	const job = workflow.jobs.release;
	expect(job["runs-on"]).toEqual([
		"self-hosted",
		"linux",
		"x64",
		"questpie-release",
	]);
	const postgres = job.services?.postgres;
	expect(postgres).toBeDefined();
	expect(postgres!.image).toBe("postgres:17");
	expect(postgres!.ports).toEqual(["127.0.0.1::5432"]);
	expect(postgres!.volumes).toBeUndefined();
	expect(postgres!.env).toMatchObject({
		POSTGRES_DB: "questpie_release",
		POSTGRES_USER: "questpie_release",
		POSTGRES_HOST_AUTH_METHOD: "trust",
		PGDATA: "/var/lib/postgresql/questpie-release",
	});
	expect(postgres!.options).toContain("--tmpfs /var/lib/postgresql/data");
	expect(postgres!.options).not.toContain("--mount");
	expect(postgres!.options).toContain("--health-cmd");
	const workload = job.steps.find((step) => step.id === "workloads")!;
	expect(workload.env).toMatchObject({
		PGHOST: "127.0.0.1",
		PGPORT: "${{ job.services.postgres.ports['5432'] }}",
		PGDATABASE: "questpie_release",
		PGUSER: "questpie_release",
		QUESTPIE_POSTGRES_MAJOR: "17",
		QUESTPIE_PERFORMANCE_EVIDENCE_CLASS: "release-stable-runner-postgres17",
	});
	expect(workload.run).toContain('[[ "$PGPORT" =~ ^[0-9]+$ ]]');
	expect(workload.run).toContain("unset DATABASE_URL SQL_DATABASE_URL");
	// PostgreSQL stays out of ordinary test discovery and package-only checks.
	expect(
		job.steps.find((step) => step.run === "bun run quality:release")!.env,
	).toBeUndefined();
});

test("manual validation cannot publish, even when dispatched against a tag", () => {
	expect(Object.keys(workflow.on).sort()).toEqual([
		"push",
		"workflow_dispatch",
	]);
	expect(workflow.on.workflow_dispatch).toEqual({});
	expect(workflow.on.push).toEqual({ tags: ["v*"] });
	const steps = workflow.jobs.release.steps;
	const checkout = steps.find((step) =>
		step.uses?.startsWith("actions/checkout@"),
	)!;
	expect(checkout.with?.ref).toBe("${{ github.sha }}");
	const publish = steps.find((step) => step.run === "bun run release")!;
	expect(publish.if).toBe(
		"${{ success() && github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v') }}",
	);
	expect(publish["continue-on-error"]).toBeUndefined();
	const checks = steps.filter((step) =>
		step.run?.includes('test "$(git rev-parse HEAD)" = "$GITHUB_SHA"'),
	);
	expect(checks).toHaveLength(2);
	expect(steps.indexOf(checks[0]!)).toBeLessThan(
		steps.findIndex((step) => step.run === "bun run quality:release"),
	);
	expect(steps.indexOf(checks[1]!)).toBeGreaterThan(
		steps.findIndex((step) => step.id === "workloads"),
	);
	expect(steps.indexOf(checks[1]!)).toBeLessThan(steps.indexOf(publish));
	for (const check of checks) {
		expect(check.if).toBeUndefined();
		expect(check["continue-on-error"]).toBeUndefined();
		expect(check.run).toContain("git diff --quiet HEAD --");
	}
});

test("the real workflow shell stops on workload failure and preserves its evidence", () => {
	const root = mkdtempSync(join(tmpdir(), "questpie-release-shell-"));
	try {
		// Stub the process boundary only. No benchmark or PostgreSQL is executed.
		writeFileSync(
			join(root, "bun"),
			'#!/bin/sh\nif [ "$1" = "-e" ]; then exit 0; fi\nprintf "%s\\n" "$*"\nexit 42\n',
			{ mode: 0o700 },
		);
		const outputs = join(root, "outputs");
		const command = workflow.jobs.release.steps.find(
			(step) => step.id === "workloads",
		)!.run!;
		const result = Bun.spawnSync(["bash", "-c", command], {
			env: {
				PATH: `${root}:/usr/bin:/bin`,
				RUNNER_TEMP: root,
				GITHUB_OUTPUT: outputs,
				GITHUB_SHA: "a".repeat(40),
				GITHUB_RUN_ID: "123",
				GITHUB_RUN_ATTEMPT: "1",
				PGPORT: "54321",
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(result.exitCode).toBe(42);
		expect(result.stdout.toString()).toContain("beta08-worker-contention");
		expect(result.stdout.toString()).not.toContain("beta10-ten-instance");
		const logs = readFileSync(outputs, "utf8").trim().slice("logs=".length);
		expect(readFileSync(join(logs, "identity.txt"), "utf8")).toContain(
			`commit=${"a".repeat(40)}`,
		);
		expect(
			readFileSync(join(logs, "beta08-worker-contention.log"), "utf8"),
		).toContain("beta08-worker-contention");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test.each(["", "0", "65536", "wrong"])(
	"missing or invalid service port %j cannot fall back to a supplied database",
	(port) => {
		const root = mkdtempSync(join(tmpdir(), "questpie-release-port-"));
		try {
			writeFileSync(
				join(root, "bun"),
				'#!/bin/sh\nprintf "DATABASE_WAS_TOUCHED\\n"\n',
				{ mode: 0o700 },
			);
			const command = workflow.jobs.release.steps.find(
				(step) => step.id === "workloads",
			)!.run!;
			const result = Bun.spawnSync(["bash", "-c", command], {
				env: {
					PATH: `${root}:/usr/bin:/bin`,
					RUNNER_TEMP: root,
					GITHUB_OUTPUT: join(root, "outputs"),
					GITHUB_SHA: "a".repeat(40),
					GITHUB_RUN_ID: "123",
					GITHUB_RUN_ATTEMPT: "1",
					PGPORT: port,
				},
				stdout: "pipe",
				stderr: "pipe",
			});
			expect(result.exitCode).not.toBe(0);
			expect(result.stdout.toString()).not.toContain("DATABASE_WAS_TOUCHED");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
);

test("inherited database settings cannot activate PostgreSQL during ordinary quality", () => {
	const env = workflow.jobs.release.env;
	for (const key of [
		"PGHOST",
		"PGPORT",
		"PGDATABASE",
		"PGUSER",
		"PGPASSWORD",
		"DATABASE_URL",
		"SQL_DATABASE_URL",
		"PG_HOST",
		"PG_PORT",
		"PG_DATABASE",
		"PG_USER",
		"PG_PASSWORD",
	])
		expect(env?.[key]).toBe("");
});

test("evidence upload is mandatory and owned log cleanup runs even after failure", () => {
	const steps = workflow.jobs.release.steps;
	const upload = steps.find((step) =>
		step.uses?.startsWith("actions/upload-artifact@"),
	)!;
	expect(upload.if).toBe(
		"${{ always() && steps.workloads.outputs.logs != '' }}",
	);
	expect(upload.with?.["if-no-files-found"]).toBe("error");
	expect(upload.with?.name).toContain("${{ github.sha }}");
	expect(upload["continue-on-error"]).toBeUndefined();
	const cleanup = steps.find((step) => step.id === "cleanup-workload-logs");
	expect(cleanup).toBeDefined();
	expect(cleanup!.if).toBe(
		"${{ always() && steps.workloads.outputs.logs != '' }}",
	);
	expect(steps.indexOf(cleanup!)).toBeGreaterThan(steps.indexOf(upload));
	expect(steps.indexOf(cleanup!)).toBeLessThan(
		steps.findIndex((step) => step.run === "bun run release"),
	);
});

test("cleanup removes only the owned log directory and refuses outside or symlink targets", () => {
	const root = mkdtempSync(join(tmpdir(), "questpie-release-cleanup-"));
	try {
		const temporary = join(root, "runner-temp");
		mkdirSync(temporary);
		const owned = mkdtempSync(join(temporary, "questpie-release-workloads."));
		const outside = mkdtempSync(join(root, "questpie-release-workloads."));
		const link = join(temporary, "questpie-release-workloads.abcdef");
		symlinkSync(outside, link);
		const command = workflow.jobs.release.steps.find(
			(step) => step.id === "cleanup-workload-logs",
		)!.run!;
		const cleanup = (target: string) =>
			Bun.spawnSync(["bash", "-c", command], {
				env: {
					PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
					RUNNER_TEMP: temporary,
					WORKLOAD_LOGS: target,
				},
				stdout: "pipe",
				stderr: "pipe",
			});
		expect(cleanup(outside).exitCode).not.toBe(0);
		expect(cleanup(link).exitCode).not.toBe(0);
		expect(cleanup(temporary).exitCode).not.toBe(0);
		expect(existsSync(outside)).toBe(true);
		expect(existsSync(link)).toBe(true);
		expect(cleanup(owned).exitCode).toBe(0);
		expect(existsSync(owned)).toBe(false);
		expect(existsSync(outside)).toBe(true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
