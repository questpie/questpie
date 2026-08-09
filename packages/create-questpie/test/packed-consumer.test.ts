import { afterAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
	chmod,
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

import { preparePublishManifest } from "../../../scripts/publish-manifest";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const QUESTPIE_PACKAGE = join(REPO_ROOT, "packages/questpie");
const PROCESS_TIMEOUT_MS = 120_000;
const WORKFLOW_TIMEOUT_MS = PROCESS_TIMEOUT_MS * 5 + 15_000;

let workspace: string | undefined;

type ActiveProcess = {
	child: ReturnType<typeof spawn>;
	exited: Promise<number>;
};

const activeProcesses = new Set<ActiveProcess>();

type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

const wait = (milliseconds: number) =>
	new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds));

function killProcessGroup(
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

async function terminateProcess({
	child,
	exited,
}: ActiveProcess): Promise<void> {
	killProcessGroup(child, "SIGTERM");
	const terminated = await Promise.race([
		exited.then(() => true),
		wait(1_000).then(() => false),
	]);
	if (!terminated) killProcessGroup(child, "SIGKILL");
	await Promise.race([exited, wait(1_000)]);
}

async function run(
	command: string[],
	options: { cwd: string; timeoutMs?: number },
): Promise<CommandResult> {
	const child = spawn(command[0]!, command.slice(1), {
		cwd: options.cwd,
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
	const activeProcess = { child, exited };
	activeProcesses.add(activeProcess);
	child.once("close", () => activeProcesses.delete(activeProcess));
	const timeoutMs = options.timeoutMs ?? PROCESS_TIMEOUT_MS;
	let timeout: ReturnType<typeof setTimeout> | undefined;

	try {
		const outcome = await Promise.race([
			exited.then((exitCode) => ({ kind: "exit" as const, exitCode })),
			new Promise<{ kind: "timeout" }>((resolveTimeout) => {
				timeout = setTimeout(
					() => resolveTimeout({ kind: "timeout" }),
					timeoutMs,
				);
			}),
		]);
		if (timeout) clearTimeout(timeout);

		if (outcome.kind === "timeout") {
			await terminateProcess(activeProcess);
			throw new Error(
				`Command timed out after ${timeoutMs}ms: ${command.join(" ")}\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}`,
			);
		}

		const exitCode = outcome.exitCode;
		return {
			exitCode,
			stdout,
			stderr,
		};
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

function packedTarballFilename(result: CommandResult): string {
	try {
		const packed = JSON.parse(result.stdout) as { filename?: unknown }[];
		if (typeof packed[0]?.filename === "string") return packed[0].filename;
	} catch {
		// The contextual error below includes the raw subprocess output.
	}
	throw new Error(
		`npm pack --json returned an invalid manifest\n\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`,
	);
}

async function stagePublishedQuestpie(stageDir: string): Promise<void> {
	const sourceManifest = JSON.parse(
		await readFile(join(QUESTPIE_PACKAGE, "package.json"), "utf8"),
	) as Parameters<typeof preparePublishManifest>[0];
	const { manifest } = preparePublishManifest(sourceManifest, new Map());

	const serialized = JSON.stringify(manifest, null, "\t");

	await mkdir(stageDir, { recursive: true });
	await cp(join(QUESTPIE_PACKAGE, "dist"), join(stageDir, "dist"), {
		recursive: true,
	});
	if (existsSync(join(QUESTPIE_PACKAGE, "skills"))) {
		await cp(join(QUESTPIE_PACKAGE, "skills"), join(stageDir, "skills"), {
			recursive: true,
		});
	}
	await writeFile(join(stageDir, "package.json"), `${serialized}\n`);
	await chmod(join(stageDir, "dist/cli.mjs"), 0o755);
}

async function writeConsumer(
	consumerDir: string,
	tarball: string,
): Promise<void> {
	const files: Record<string, string> = {
		"package.json": `${JSON.stringify(
			{
				name: "questpie-packed-consumer",
				private: true,
				type: "module",
				imports: {
					"#questpie": "./src/questpie/server/.generated/index.ts",
					"#questpie/*": "./src/questpie/server/.generated/*",
				},
				dependencies: {
					questpie: `file:${tarball}`,
				},
				devDependencies: {
					"bun-types": "1.3.13",
					typescript: "5.9.2",
				},
			},
			null,
			"\t",
		)}\n`,
		"tsconfig.json": `${JSON.stringify(
			{
				include: ["src/**/*.ts"],
				compilerOptions: {
					target: "ES2022",
					module: "ESNext",
					moduleResolution: "Bundler",
					paths: {
						"#questpie": ["./src/questpie/server/.generated/index.ts"],
						"#questpie/*": ["./src/questpie/server/.generated/*"],
					},
					types: ["bun-types"],
					strict: true,
					noEmit: true,
					skipLibCheck: true,
				},
			},
			null,
			"\t",
		)}\n`,
		"src/questpie/server/questpie.config.ts": [
			'import { runtimeConfig } from "questpie/app";',
			"",
			"export default runtimeConfig({",
			'\tapp: { url: "http://localhost:3000" },',
			'\tdb: { url: "postgresql://questpie:questpie@localhost:5432/questpie" },',
			"});",
			"",
		].join("\n"),
		"src/questpie/server/modules.ts": "export default [] as const;\n",
		"src/questpie/server/collections/posts.ts": [
			'import { collection } from "#questpie/factories";',
			"",
			'export default collection("posts").fields(({ f }) => ({',
			"\ttitle: f.text(255).required(),",
			"}));",
			"",
		].join("\n"),
	};

	for (const [relativePath, contents] of Object.entries(files)) {
		const destination = join(consumerDir, relativePath);
		await mkdir(dirname(destination), { recursive: true });
		await writeFile(destination, contents);
	}
}

afterAll(async () => {
	await Promise.allSettled([...activeProcesses].map(terminateProcess));
	if (workspace) await rm(workspace, { recursive: true, force: true });
});

describe("packed public consumer", () => {
	test("cleans the process group when a command times out", async () => {
		if (process.platform === "win32") return;

		const cleanupWorkspace = await mkdtemp(
			join(tmpdir(), "questpie-process-cleanup-"),
		);
		const marker = join(cleanupWorkspace, "descendant-survived");

		try {
			await expect(
				run(["sh", "-c", '(sleep 0.3; touch "$1") & wait', "sh", marker], {
					cwd: cleanupWorkspace,
					timeoutMs: 50,
				}),
			).rejects.toThrow("Command timed out after 50ms");
			await wait(500);
			expect(existsSync(marker)).toBe(false);
			expect(activeProcesses.size).toBe(0);
		} finally {
			await rm(cleanupWorkspace, { recursive: true, force: true });
		}
	});

	test(
		"generates and typechecks through the installed public CLI",
		async () => {
			workspace = await mkdtemp(join(tmpdir(), "questpie-packed-consumer-"));
			const stageDir = join(workspace, "stage/questpie");
			const tarballDir = join(workspace, "tarballs");
			const consumerDir = join(workspace, "consumer");

			const build = await run(["bun", "run", "build"], {
				cwd: QUESTPIE_PACKAGE,
			});
			expectSuccess(build, "bun run build");

			await stagePublishedQuestpie(stageDir);
			await mkdir(tarballDir, { recursive: true });
			const pack = await run(
				["npm", "pack", "--json", "--pack-destination", tarballDir],
				{ cwd: stageDir },
			);
			expectSuccess(pack, "npm pack --json");
			const tarball = join(tarballDir, packedTarballFilename(pack));

			await writeConsumer(consumerDir, tarball);
			const install = await run(["bun", "install", "--no-progress"], {
				cwd: consumerDir,
			});
			expectSuccess(install, "bun install --no-progress");

			const cli = join(consumerDir, "node_modules/.bin/questpie");
			expect(existsSync(cli)).toBe(true);
			const generate = await run(
				[cli, "generate", "-c", "src/questpie/server/questpie.config.ts"],
				{ cwd: consumerDir },
			);
			expectSuccess(generate, "node_modules/.bin/questpie generate");
			expect(
				existsSync(
					join(consumerDir, "src/questpie/server/.generated/index.ts"),
				),
			).toBe(true);

			const typecheck = await run(
				[join(consumerDir, "node_modules/.bin/tsc"), "--noEmit"],
				{ cwd: consumerDir },
			);
			expectSuccess(typecheck, "node_modules/.bin/tsc --noEmit");
		},
		WORKFLOW_TIMEOUT_MS,
	);
});
