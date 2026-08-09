import { afterAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

import {
	preparePublishManifest,
	type PublishManifest,
} from "./publish-manifest";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const PACKAGE_NAMES = ["questpie", "hono", "elysia", "next"] as const;
const PROCESS_TIMEOUT_MS = 120_000;

let workspace: string | undefined;

type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

const delay = (milliseconds: number) =>
	new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));

function stopProcessGroup(
	child: ReturnType<typeof spawn>,
	signal: NodeJS.Signals,
): void {
	if (process.platform !== "win32" && child.pid) {
		try {
			process.kill(-child.pid, signal);
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
		}
	}
	child.kill(signal);
}

async function run(command: string[], cwd: string): Promise<CommandResult> {
	const child = spawn(command[0]!, command.slice(1), {
		cwd,
		detached: process.platform !== "win32",
		env: { ...process.env, CI: "1", NO_COLOR: "1" },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => (stdout += chunk));
	child.stderr.on("data", (chunk: string) => (stderr += chunk));
	const exited = new Promise<number>((resolveExit, rejectExit) => {
		child.once("error", rejectExit);
		child.once("close", (code) => resolveExit(code ?? 1));
	});
	let timeout: ReturnType<typeof setTimeout> | undefined;

	try {
		const outcome = await Promise.race([
			exited.then((exitCode) => ({ kind: "exit" as const, exitCode })),
			new Promise<{ kind: "timeout" }>((resolveTimeout) => {
				timeout = setTimeout(
					() => resolveTimeout({ kind: "timeout" }),
					PROCESS_TIMEOUT_MS,
				);
			}),
		]);
		if (outcome.kind === "timeout") {
			stopProcessGroup(child, "SIGTERM");
			if (
				!(await Promise.race([
					exited.then(() => true),
					delay(1_000).then(() => false),
				]))
			) {
				stopProcessGroup(child, "SIGKILL");
			}
			await Promise.race([exited, delay(1_000)]);
			throw new Error(
				`Command timed out: ${command.join(" ")}\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}`,
			);
		}
		return { exitCode: outcome.exitCode, stdout, stderr };
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

function expectSuccess(result: CommandResult, command: string): void {
	expect(
		result.exitCode,
		`${command}\n\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`,
	).toBe(0);
}

function packedFilename(result: CommandResult): string {
	const entries = JSON.parse(result.stdout) as { filename?: unknown }[];
	if (typeof entries[0]?.filename !== "string") {
		throw new Error(`npm pack returned no filename: ${result.stdout}`);
	}
	return entries[0].filename;
}

async function readManifest(packageDir: string): Promise<PublishManifest> {
	return JSON.parse(
		await readFile(join(packageDir, "package.json"), "utf8"),
	) as PublishManifest;
}

async function stageAndPack(
	packageName: (typeof PACKAGE_NAMES)[number],
	versions: ReadonlyMap<string, string>,
	tarballDir: string,
): Promise<string> {
	const packageDir = join(REPO_ROOT, "packages", packageName);
	const stageDir = join(workspace!, "stage", packageName);
	const { manifest } = preparePublishManifest(
		await readManifest(packageDir),
		versions,
	);
	await mkdir(stageDir, { recursive: true });
	await cp(join(packageDir, "dist"), join(stageDir, "dist"), {
		recursive: true,
	});
	await writeFile(
		join(stageDir, "package.json"),
		`${JSON.stringify(manifest, null, "\t")}\n`,
	);
	const result = await run(
		["npm", "pack", "--json", "--pack-destination", tarballDir],
		stageDir,
	);
	expectSuccess(result, `npm pack ${packageName}`);
	return join(tarballDir, packedFilename(result));
}

afterAll(async () => {
	if (workspace) await rm(workspace, { recursive: true, force: true });
});

describe("packed HTTP adapter consumer", () => {
	test(
		"runtime-imports and typechecks every public adapter code export",
		async () => {
			workspace = await mkdtemp(join(tmpdir(), "questpie-http-adapters-"));
			const tarballDir = join(workspace, "tarballs");
			const consumerDir = join(workspace, "consumer");
			await Promise.all([
				mkdir(tarballDir),
				mkdir(join(consumerDir, "src"), { recursive: true }),
			]);

			const packageDirs = PACKAGE_NAMES.map((name) =>
				join(REPO_ROOT, "packages", name),
			);
			const builds = await Promise.all(
				packageDirs.map((cwd) => run(["bun", "run", "build"], cwd)),
			);
			for (const [index, result] of builds.entries()) {
				expectSuccess(result, `bun run build (${PACKAGE_NAMES[index]})`);
			}

			const sourceManifests = await Promise.all(packageDirs.map(readManifest));
			const versions = new Map(
				sourceManifests.map((manifest) => [
					manifest.name as string,
					manifest.version as string,
				]),
			);
			const tarballs = await Promise.all(
				PACKAGE_NAMES.map((name) => stageAndPack(name, versions, tarballDir)),
			);

			await writeFile(
				join(consumerDir, "package.json"),
				`${JSON.stringify(
					{
						name: "questpie-http-adapter-consumer",
						private: true,
						type: "module",
						dependencies: {
							questpie: `file:${tarballs[0]}`,
							"@questpie/hono": `file:${tarballs[1]}`,
							"@questpie/elysia": `file:${tarballs[2]}`,
							"@questpie/next": `file:${tarballs[3]}`,
							hono: "^4.12.25",
							elysia: "^1.2.14",
							"@elysiajs/eden": "^1.2.6",
						},
						devDependencies: {
							"bun-types": "1.3.13",
							typescript: "5.9.2",
						},
						overrides: {
							questpie: `file:${tarballs[0]}`,
						},
					},
					null,
					"\t",
				)}\n`,
			);
			await writeFile(
				join(consumerDir, "tsconfig.json"),
				`${JSON.stringify(
					{
						include: ["src/**/*.ts"],
						compilerOptions: {
							target: "ES2022",
							module: "ESNext",
							moduleResolution: "Bundler",
							types: ["bun-types"],
							strict: true,
							noEmit: true,
							skipLibCheck: true,
						},
					},
					null,
					"\t",
				)}\n`,
			);
			await writeFile(
				join(consumerDir, "src/index.ts"),
				[
					'import { questpieHono, type HonoAdapterConfig } from "@questpie/hono/server";',
					'import { createClientFromHono } from "@questpie/hono/client";',
					'import { questpieElysia, type ElysiaAdapterConfig } from "@questpie/elysia/server";',
					'import { createClientFromEden } from "@questpie/elysia/client";',
					'import { questpieNextRouteHandlers, type NextAdapterConfig } from "@questpie/next";',
					'import type { NativeAdapterConfig } from "questpie/http";',
					"void [questpieHono, createClientFromHono, questpieElysia, createClientFromEden, questpieNextRouteHandlers];",
					"const honoConfig: HonoAdapterConfig = {};",
					"const elysiaConfig: ElysiaAdapterConfig = {};",
					"const nativeConfig: NativeAdapterConfig = {};",
					'const nextConfig: NextAdapterConfig = { accessMode: "system" };',
					"void [honoConfig, elysiaConfig, nativeConfig, nextConfig];",
					"",
				].join("\n"),
			);
			await writeFile(
				join(consumerDir, "runtime.mjs"),
				[
					'await import("questpie/http");',
					'await import("@questpie/hono/server");',
					'await import("@questpie/hono/client");',
					'await import("@questpie/elysia/server");',
					'await import("@questpie/elysia/client");',
					'await import("@questpie/next");',
					'console.log("packed adapter imports ok");',
					"",
				].join("\n"),
			);

			const install = await run(
				["bun", "install", "--no-progress"],
				consumerDir,
			);
			expectSuccess(install, "bun install --no-progress");
			const runtime = await run(["bun", "run", "runtime.mjs"], consumerDir);
			expectSuccess(runtime, "bun run runtime.mjs");
			expect(runtime.stdout).toContain("packed adapter imports ok");
			const typecheck = await run(
				[join(consumerDir, "node_modules/.bin/tsc"), "--noEmit"],
				consumerDir,
			);
			expectSuccess(typecheck, "node_modules/.bin/tsc --noEmit");
		},
		PROCESS_TIMEOUT_MS * 5,
	);
});
