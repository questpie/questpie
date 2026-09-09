import { expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
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

test("release quality explicitly selects all three native browser proofs", () => {
	const quality = readFileSync(
		join(repositoryRoot, "scripts/quality.ts"),
		"utf8",
	);
	expect(quality).toContain('QUESTPIE_NATIVE_PACKED_BROWSER: "1"');
	expect(quality).toContain('QUESTPIE_NATIVE_DOCS_BROWSER: "1"');
	expect(quality).toContain('QUESTPIE_NATIVE_START_DOCS_BROWSER: "1"');
	expect(quality).toContain(
		"tests/integration/native-react-query-packed.test.ts",
	);
	expect(quality).toContain(
		"tests/integration/native-query-docs-packed.test.ts",
	);
	expect(quality).toContain(
		"tests/integration/native-query-start-docs.test.ts",
	);
});

test("ordinary release-contract discovery does not dispatch the browser dry-run without opt-in", () => {
	const temporary = mkdtempSync(
		join(tmpdir(), "questpie-release-lane-control-"),
	);
	try {
		writeFileSync(
			join(temporary, "package.json"),
			JSON.stringify({
				private: true,
				scripts: { release: "bun release-control.ts" },
			}),
		);
		writeFileSync(
			join(temporary, "release-control.ts"),
			'console.error("HEAVY_RELEASE_DISPATCHED"); process.exit(87);',
		);
		const command = [
			process.execPath,
			"test",
			join(repositoryRoot, "tests/unit/beta12-release-contract.test.ts"),
			"--test-name-pattern",
			"dry-run packs",
		];
		const ordinary = Bun.spawnSync(command, {
			cwd: temporary,
			env: {
				...process.env,
				QUESTPIE_RELEASE_DRY_RUN_CONTRACT: "",
			},
			stdout: "pipe",
			stderr: "pipe",
			timeout: 5_000,
		});
		expect(ordinary.exitCode, ordinary.stderr.toString()).toBe(0);
		expect(
			ordinary.stdout.toString() + ordinary.stderr.toString(),
		).not.toContain("HEAVY_RELEASE_DISPATCHED");
		const release = Bun.spawnSync(command, {
			cwd: temporary,
			env: {
				...process.env,
				QUESTPIE_RELEASE_DRY_RUN_CONTRACT: "1",
			},
			stdout: "pipe",
			stderr: "pipe",
			timeout: 5_000,
		});
		expect(release.exitCode).not.toBe(0);
		expect(release.stdout.toString() + release.stderr.toString()).toContain(
			"HEAVY_RELEASE_DISPATCHED",
		);
		const quality = readFileSync(
			join(repositoryRoot, "scripts/quality.ts"),
			"utf8",
		);
		expect(quality).toContain('QUESTPIE_RELEASE_DRY_RUN_CONTRACT: "1"');
		expect(quality).toContain('"tests/unit/beta12-release-contract.test.ts"');
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
});

test("ordinary quality excludes only the named manual release benchmark while its workload remains registered", () => {
	const quality = readFileSync(
		join(repositoryRoot, "scripts/quality.ts"),
		"utf8",
	);
	const flag =
		"--path-ignore-patterns=**/tests/performance/beta12-release.test.ts";
	expect(quality).toContain(flag);
	const temporary = mkdtempSync(
		join(tmpdir(), "questpie-release-benchmark-discovery-"),
	);
	try {
		mkdirSync(join(temporary, "tests/performance"), { recursive: true });
		writeFileSync(
			join(temporary, "tests/performance/beta12-release.test.ts"),
			'throw new Error("MANUAL_RELEASE_BENCHMARK_DISCOVERED");',
		);
		writeFileSync(
			join(temporary, "ordinary.test.ts"),
			'import { expect, test } from "bun:test"; test("ordinary control", () => expect(true).toBe(true));',
		);
		const discovery = Bun.spawnSync([process.execPath, "test", flag], {
			cwd: temporary,
			stdout: "pipe",
			stderr: "pipe",
			timeout: 5_000,
		});
		expect(discovery.exitCode, discovery.stderr.toString()).toBe(0);
		expect(
			discovery.stdout.toString() + discovery.stderr.toString(),
		).not.toContain("MANUAL_RELEASE_BENCHMARK_DISCOVERED");
		const manifest = JSON.parse(
			readFileSync(
				join(repositoryRoot, "quality/performance/beta12-release-gate.json"),
				"utf8",
			),
		);
		expect(manifest.schedule).toBe("manual");
		expect(manifest.command).toEqual([
			"bun",
			"test",
			"tests/performance/beta12-release.test.ts",
		]);
		expect(manifest.metrics.packedReleaseDryRunMs.budget).toBe(15_000);
		expect(
			readFileSync(
				join(repositoryRoot, "tests/performance/beta12-release.test.ts"),
				"utf8",
			),
		).toContain("toBeLessThanOrEqual(15_000)");
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
});

test("a rejected dry-run manifest still removes its owned package scratch directory", () => {
	const root = mkdtempSync(join(tmpdir(), "questpie-release-cleanup-"));
	try {
		const manifest = JSON.parse(
			readFileSync(
				join(repositoryRoot, "quality/release/package-artifacts.json"),
				"utf8",
			),
		);
		manifest.packages[0].sha256 = "0".repeat(64);
		const path = join(root, "invalid-manifest.json");
		writeFileSync(path, JSON.stringify(manifest));
		const result = Bun.spawnSync(
			[
				process.execPath,
				join(repositoryRoot, "scripts/release.ts"),
				"--dry-run",
				"--artifact-manifest",
				path,
			],
			{
				cwd: repositoryRoot,
				env: { ...process.env, TMPDIR: root },
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain("artifact checksum mismatch");
		expect(
			readdirSync(root, { withFileTypes: true }).filter((entry) =>
				entry.isDirectory(),
			),
		).toEqual([]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}, 30_000);

test("both beta archives publish only to the explicit beta dist-tag", () => {
	const root = mkdtempSync(join(tmpdir(), "questpie-release-tag-"));
	try {
		// Only this recorder is executable through PATH: no real npm or network.
		writeFileSync(join(root, "npm"), '#!/bin/sh\nprintf "%s\\n" "$*"\n', {
			mode: 0o700,
		});
		for (const name of ["questpie", "opentelemetry"]) {
			const directory = join(root, "packages", name);
			mkdirSync(directory, { recursive: true });
			writeFileSync(
				join(directory, "package.json"),
				readFileSync(join(repositoryRoot, "packages", name, "package.json")),
			);
		}
		const result = Bun.spawnSync(
			[process.execPath, join(repositoryRoot, "scripts/release.ts")],
			{
				cwd: root,
				env: {
					PATH: root,
					GITHUB_ACTIONS: "true",
					GITHUB_REF_TYPE: "tag",
					npm_config_tag: "latest",
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString().trim().split("\n")).toEqual([
			"publish --provenance --access public --tag beta",
			"publish --provenance --access public --tag beta",
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

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
