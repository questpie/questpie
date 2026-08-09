import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

import {
	preparePublishManifest,
	type PublishManifest,
} from "../../../scripts/publish-manifest";
import {
	type ActiveProcess,
	createSubprocessHarness,
	type ExitResult,
	type ProcessResult,
	wait,
} from "./helpers/subprocess";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const PACKAGE_DIRS = [
	"questpie",
	"admin",
	"openapi",
	"tanstack-query",
	"hono",
	"elysia",
	"next",
	"create-questpie",
] as const;
const ALL_RUNTIMES = ["next", "tanstack-start", "hono", "elysia"] as const;
const COMMAND_TIMEOUT_MS = 240_000;
const BOOT_TIMEOUT_MS = 45_000;
const SHUTDOWN_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = COMMAND_TIMEOUT_MS * 4;

type Runtime = (typeof ALL_RUNTIMES)[number];

let workspace: string | undefined;
let createQuestpieBin: string | undefined;
let databaseContainer: string | undefined;
let databaseUrl: string | undefined;
const tarballs = new Map<string, string>();
const subprocess = createSubprocessHarness({
	commandTimeoutMs: COMMAND_TIMEOUT_MS,
	shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
});
const {
	cleanup: cleanupProcesses,
	run,
	start: startProcess,
	terminate: terminateProcess,
} = subprocess;

const runtimeFilter = process.env.QUESTPIE_SCAFFOLD_RUNTIME;
if (
	runtimeFilter &&
	!ALL_RUNTIMES.includes(runtimeFilter as (typeof ALL_RUNTIMES)[number])
) {
	throw new Error(
		`Unknown QUESTPIE_SCAFFOLD_RUNTIME ${JSON.stringify(runtimeFilter)}. Expected one of: ${ALL_RUNTIMES.join(", ")}`,
	);
}
const RUNTIMES: readonly Runtime[] = runtimeFilter
	? [runtimeFilter as Runtime]
	: ALL_RUNTIMES;
const adapterPackageDirs = new Set(["next", "hono", "elysia"]);
const adapterPackage = runtimeFilter
	? {
			next: "next",
			"tanstack-start": undefined,
			hono: "hono",
			elysia: "elysia",
		}[runtimeFilter as Runtime]
	: undefined;
const packageDirs = runtimeFilter
	? PACKAGE_DIRS.filter(
			(packageDir) =>
				!adapterPackageDirs.has(packageDir) || packageDir === adapterPackage,
		)
	: PACKAGE_DIRS;

function assertSuccess(result: ProcessResult, label: string): void {
	if (result.code === 0) return;
	throw new Error(
		`${label} exited with code ${result.code} (${result.signal ?? "no signal"})\n\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`,
	);
}

async function readManifest(packageDir: string): Promise<PublishManifest> {
	return JSON.parse(
		await readFile(join(packageDir, "package.json"), "utf8"),
	) as PublishManifest;
}

function packedFilename(result: ProcessResult): string {
	const entries = JSON.parse(result.stdout) as { filename?: unknown }[];
	if (typeof entries[0]?.filename !== "string") {
		throw new Error(`npm pack returned no filename: ${result.stdout}`);
	}
	return entries[0].filename;
}

async function stageAndPack(
	packageDirName: (typeof PACKAGE_DIRS)[number],
	versions: ReadonlyMap<string, string>,
	tarballDir: string,
): Promise<void> {
	const packageDir = join(REPO_ROOT, "packages", packageDirName);
	const stageDir = join(workspace!, "stage", packageDirName);
	const sourceManifest = await readManifest(packageDir);
	const { manifest } = preparePublishManifest(sourceManifest, versions);
	const packageName = String(manifest.name);

	await mkdir(stageDir, { recursive: true });
	for (const entry of (manifest.files as string[] | undefined) ?? []) {
		const source = join(packageDir, entry);
		if (!existsSync(source)) continue;
		await cp(source, join(stageDir, entry), { recursive: true });
	}
	await writeFile(
		join(stageDir, "package.json"),
		`${JSON.stringify(manifest, null, "\t")}\n`,
	);

	const packed = await run(
		["npm", "pack", "--json", "--pack-destination", tarballDir],
		{ cwd: stageDir },
	);
	assertSuccess(packed, `npm pack ${packageName}`);
	tarballs.set(packageName, join(tarballDir, packedFilename(packed)));
}

async function getRandomPort(): Promise<number> {
	return new Promise<number>((resolvePort, rejectPort) => {
		const server = createServer();
		server.unref();
		server.once("error", rejectPort);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				rejectPort(new Error("Could not allocate an isolated TCP port"));
				return;
			}
			server.close((error) => {
				if (error) rejectPort(error);
				else resolvePort(address.port);
			});
		});
	});
}

async function waitForApi(
	url: string,
	active: ActiveProcess,
): Promise<{ status: number; body: string }> {
	const deadline = Date.now() + BOOT_TIMEOUT_MS;
	let lastError = "server did not answer";
	let exited: ExitResult | undefined;
	void active.exited.then((result) => (exited = result));

	while (Date.now() < deadline) {
		if (exited) {
			throw new Error(
				`Server exited before its API probe (${exited.code}, ${exited.signal ?? "no signal"})\n\nstdout:\n${active.stdout()}\n\nstderr:\n${active.stderr()}`,
			);
		}
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
			const body = await response.text();
			if (response.status >= 200 && response.status < 500) {
				return { status: response.status, body };
			}
			lastError = `HTTP ${response.status}: ${body.slice(0, 500)}`;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
		await wait(250);
	}

	throw new Error(
		`API probe timed out after ${BOOT_TIMEOUT_MS}ms (${lastError})\n\nstdout:\n${active.stdout()}\n\nstderr:\n${active.stderr()}`,
	);
}

async function probe(url: string): Promise<{
	status: number;
	body: string;
	contentType: string;
	location: string | null;
}> {
	const response = await fetch(url, {
		redirect: "manual",
		signal: AbortSignal.timeout(2_000),
	});
	return {
		status: response.status,
		body: await response.text(),
		contentType: response.headers.get("content-type") ?? "",
		location: response.headers.get("location"),
	};
}

function recordStep(
	log: string[],
	label: string,
	command: string[],
	result: ProcessResult,
): void {
	log.push(
		`## ${label}\n$ ${command.join(" ")}\nexit=${result.code} signal=${result.signal ?? "none"}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
	);
}

async function runStep(
	log: string[],
	label: string,
	command: string[],
	options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<void> {
	const result = await run(command, options);
	recordStep(log, label, command, result);
	assertSuccess(result, label);
}

async function installPackedDependencies(projectDir: string): Promise<void> {
	const packageJsonPath = join(projectDir, "package.json");
	const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
		overrides?: Record<string, string>;
	};
	const overrides: Record<string, string> = {};

	for (const [packageName, tarball] of tarballs) {
		if (packageName === "create-questpie") continue;
		const reference = `file:${tarball}`;
		if (packageName in (packageJson.dependencies ?? {})) {
			packageJson.dependencies![packageName] = reference;
		}
		if (packageName in (packageJson.devDependencies ?? {})) {
			packageJson.devDependencies![packageName] = reference;
		}
		overrides[packageName] = reference;
	}
	packageJson.overrides = { ...packageJson.overrides, ...overrides };
	await writeFile(
		packageJsonPath,
		`${JSON.stringify(packageJson, null, "\t")}\n`,
	);
}

async function startDisposableDatabase(): Promise<void> {
	databaseContainer = `questpie-scaffold-matrix-${process.pid}-${Date.now()}`;
	const started = await run(
		[
			"docker",
			"run",
			"--detach",
			"--rm",
			"--name",
			databaseContainer,
			"--env",
			"POSTGRES_USER=questpie",
			"--env",
			"POSTGRES_PASSWORD=questpie",
			"--env",
			"POSTGRES_DB=questpie",
			"--publish",
			"127.0.0.1::5432",
			"postgres:17-alpine",
		],
		{ cwd: workspace!, timeoutMs: COMMAND_TIMEOUT_MS },
	);
	assertSuccess(started, "start disposable PostgreSQL");

	const portResult = await run(
		["docker", "port", databaseContainer, "5432/tcp"],
		{ cwd: workspace! },
	);
	assertSuccess(portResult, "resolve disposable PostgreSQL port");
	const port = portResult.stdout.trim().match(/:(\d+)$/)?.[1];
	if (!port)
		throw new Error(`Could not parse PostgreSQL port: ${portResult.stdout}`);
	databaseUrl = `postgresql://questpie:questpie@127.0.0.1:${port}/questpie`;

	const deadline = Date.now() + BOOT_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const ready = await run(
			["docker", "exec", databaseContainer, "pg_isready", "-U", "questpie"],
			{ cwd: workspace!, timeoutMs: 5_000 },
		);
		if (ready.code === 0) return;
		await wait(250);
	}
	throw new Error("Disposable PostgreSQL did not become ready");
}

function productionCommand(runtime: Runtime, projectDir: string, port: number) {
	if (runtime === "next") {
		return [
			join(projectDir, "node_modules/.bin/next"),
			"start",
			"--port",
			String(port),
		];
	}
	if (runtime === "tanstack-start") {
		return ["bun", "run", ".output/server/index.mjs"];
	}
	return ["bun", "run", "dist/index.js"];
}

const runtimeMatrix =
	process.env.QUESTPIE_SCAFFOLD_RUNTIME_MATRIX === "1"
		? describe
		: describe.skip;

runtimeMatrix("packed generated scaffold runtime matrix", () => {
	beforeAll(async () => {
		workspace = await mkdtemp(join(tmpdir(), "questpie-scaffold-matrix-"));
		const tarballDir = join(workspace, "tarballs");
		await mkdir(tarballDir, { recursive: true });

		const packageRoots = (
			await readdir(join(REPO_ROOT, "packages"), {
				withFileTypes: true,
			})
		)
			.filter((entry) => entry.isDirectory())
			.map((entry) => join(REPO_ROOT, "packages", entry.name))
			.filter((directory) => existsSync(join(directory, "package.json")));
		const workspaceManifests = await Promise.all(
			packageRoots.map(readManifest),
		);
		const versions = new Map(
			workspaceManifests
				.filter((manifest) => typeof manifest.name === "string")
				.map((manifest) => [String(manifest.name), String(manifest.version)]),
		);

		for (const packageDirName of packageDirs) {
			const packageDir = join(REPO_ROOT, "packages", packageDirName);
			await rm(join(packageDir, "dist"), { recursive: true, force: true });
			const build = await run(["bun", "run", "build"], { cwd: packageDir });
			assertSuccess(build, `build ${packageDirName}`);
		}
		for (const packageDirName of packageDirs) {
			await stageAndPack(packageDirName, versions, tarballDir);
		}

		const runnerDir = join(workspace, "create-runner");
		await mkdir(runnerDir, { recursive: true });
		await writeFile(
			join(runnerDir, "package.json"),
			`${JSON.stringify(
				{
					name: "questpie-scaffold-matrix-runner",
					private: true,
					dependencies: {
						"create-questpie": `file:${tarballs.get("create-questpie")}`,
					},
				},
				null,
				"\t",
			)}\n`,
		);
		const install = await run(["bun", "install", "--no-progress"], {
			cwd: runnerDir,
		});
		assertSuccess(install, "install packed create-questpie");
		createQuestpieBin = join(runnerDir, "node_modules/.bin/create-questpie");
		expect(existsSync(createQuestpieBin)).toBe(true);
		await startDisposableDatabase();
	}, TEST_TIMEOUT_MS);

	afterAll(async () => {
		await cleanupProcesses();
		if (databaseContainer) {
			await run(["docker", "rm", "--force", databaseContainer], {
				cwd: workspace ?? REPO_ROOT,
				timeoutMs: 10_000,
			}).catch(() => {});
		}
		if (workspace) await rm(workspace, { recursive: true, force: true });
	});

	for (const runtime of RUNTIMES) {
		test(
			`${runtime}: generate, typecheck, build, boot, probe, and terminate`,
			async () => {
				const startedAt = performance.now();
				const log: string[] = [];
				const caseDir = join(workspace!, "cases", runtime);
				const projectDir = join(caseDir, "app");
				const runtimeEnv = { DATABASE_URL: databaseUrl! };
				let server: ActiveProcess | undefined;
				await mkdir(caseDir, { recursive: true });

				try {
					await runStep(
						log,
						"scaffold through installed create-questpie",
						[
							createQuestpieBin!,
							"app",
							"--template",
							runtime,
							"--yes",
							"--no-install",
							"--no-git",
							"--no-skills",
							"--no-generate",
							"--queue",
							"none",
						],
						{ cwd: caseDir },
					);
					await installPackedDependencies(projectDir);
					await runStep(
						log,
						"install publish-shaped tarballs",
						["bun", "install", "--no-progress"],
						{ cwd: projectDir },
					);

					const questpieBin = join(projectDir, "node_modules/.bin/questpie");
					expect(existsSync(questpieBin)).toBe(true);
					await runStep(
						log,
						"generate through installed questpie",
						[
							questpieBin,
							"generate",
							"-c",
							"src/questpie/server/questpie.config.ts",
						],
						{ cwd: projectDir, env: runtimeEnv },
					);
					if (runtime === "tanstack-start") {
						await runStep(
							log,
							"generate TanStack route tree",
							["bun", "run", "routes:generate"],
							{ cwd: projectDir, env: runtimeEnv },
						);
					}
					await runStep(log, "typecheck", ["bun", "run", "check-types"], {
						cwd: projectDir,
						env: runtimeEnv,
					});
					await runStep(log, "production build", ["bun", "run", "build"], {
						cwd: projectDir,
						env: runtimeEnv,
					});

					const port = await getRandomPort();
					const command = productionCommand(runtime, projectDir, port);
					server = startProcess(command, {
						cwd: projectDir,
						env: {
							APP_URL: `http://127.0.0.1:${port}`,
							DATABASE_URL: databaseUrl,
							PORT: String(port),
						},
					});
					const baseUrl = `http://127.0.0.1:${port}`;
					const docsProbe = await waitForApi(`${baseUrl}/api/docs`, server);
					expect(docsProbe.status).toBe(200);
					const exactProbe = await probe(`${baseUrl}/api`);
					const missingProbe = await probe(`${baseUrl}/api/__matrix_missing__`);
					const siblingProbe = await probe(`${baseUrl}/apiary`);
					const rootProbe = await probe(`${baseUrl}/`);
					await wait(50);
					const runtimeStdout = server.stdout();
					log.push(
						`## production runtime\n$ ${command.join(" ")}\nprobe=/api/docs status=${docsProbe.status} bytes=${docsProbe.body.length}\nprobe=/api status=${exactProbe.status} type=${exactProbe.contentType}\nprobe=/api/__matrix_missing__ status=${missingProbe.status} type=${missingProbe.contentType}\nprobe=/apiary status=${siblingProbe.status}\nprobe=/ status=${rootProbe.status} location=${rootProbe.location ?? "none"}\nstdout:\n${runtimeStdout}\nstderr:\n${server.stderr()}`,
					);
					expect(exactProbe.status).toBe(404);
					expect(exactProbe.contentType).toContain("application/json");
					expect(missingProbe.status).toBe(404);
					expect(missingProbe.contentType).toContain("application/json");
					expect(siblingProbe.status).toBeGreaterThanOrEqual(400);
					expect(runtimeStdout).not.toContain('"path":"/apiary"');
					if (runtime === "hono" || runtime === "elysia") {
						expect(rootProbe.status).toBeGreaterThanOrEqual(300);
						expect(rootProbe.status).toBeLessThan(400);
						expect(rootProbe.location).toBe("/api/docs");
					} else {
						expect(
							rootProbe.status,
							`Root probe failed: ${rootProbe.body.slice(0, 1_000)}`,
						).toBe(200);
					}
					const exit = await terminateProcess(server);
					log.push(
						`SIGTERM exit=${exit.code} signal=${exit.signal ?? "none"}\nstdout:\n${server.stdout()}\nstderr:\n${server.stderr()}`,
					);
					server = undefined;
				} finally {
					if (server) {
						await terminateProcess(server).catch(() => {});
					}
					const elapsedMs = Math.round(performance.now() - startedAt);
					console.log(
						`\n[scaffold-runtime-matrix:${runtime}] elapsed=${elapsedMs}ms\n${log.join("\n\n")}`,
					);
					await rm(caseDir, { recursive: true, force: true });
				}
			},
			TEST_TIMEOUT_MS,
		);
	}
});
