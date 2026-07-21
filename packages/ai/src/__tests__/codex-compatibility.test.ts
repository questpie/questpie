import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
	HarnessV1NetworkSandboxSession,
	HarnessV1SandboxProvider,
} from "@ai-sdk/harness";
import { VERSION as ADAPTER_VERSION } from "@ai-sdk/harness-codex";
import { HarnessAgent, type HarnessAgentSession } from "@ai-sdk/harness/agent";
import type { Experimental_SandboxSession } from "@ai-sdk/provider-utils";

import {
	CODEX_ADAPTER_VERSION,
	CODEX_CLI_VERSION,
	CODEX_SDK_VERSION,
	DEPRECATED_CODEX_MODEL,
	createQuestpieCodex,
} from "../server/modules/ai/lib/codex-compatibility.js";
import {
	CODEX_SMOKE_EXPECTED_OUTPUT,
	isExactCodexSmokeOutput,
	runWithCodexSmokeCleanup,
} from "../server/modules/ai/lib/codex-smoke-safety.js";
import { createLocalHostSandbox } from "../server/worker/local-host-sandbox.js";

const UPSTREAM_BOOTSTRAP_DIR = "/tmp/harness/codex";
const EXPLICIT_TEST_MODEL = "gpt-5.4";

interface ProcessResult {
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	pid?: number;
}

let root = "";
let bootstrapRoot = "";
let bootstrap: Awaited<
	ReturnType<
		NonNullable<ReturnType<typeof createQuestpieCodex>["getBootstrap"]>
	>
>;

function mapBootstrapPath(path: string) {
	if (path === UPSTREAM_BOOTSTRAP_DIR) return bootstrapRoot;
	if (path.startsWith(`${UPSTREAM_BOOTSTRAP_DIR}/`)) {
		return join(bootstrapRoot, path.slice(UPSTREAM_BOOTSTRAP_DIR.length + 1));
	}
	return path;
}

function mapBootstrapCommand(command: string) {
	return command.replaceAll(UPSTREAM_BOOTSTRAP_DIR, bootstrapRoot);
}

async function pathExists(path: string) {
	return access(path).then(
		() => true,
		() => false,
	);
}

function mapSession<T extends Experimental_SandboxSession>(session: T): T {
	return {
		...session,
		run: (options) =>
			session.run({
				...options,
				command: mapBootstrapCommand(options.command),
				workingDirectory: options.workingDirectory
					? mapBootstrapPath(options.workingDirectory)
					: undefined,
			}),
		spawn: (options) =>
			session.spawn({
				...options,
				command: mapBootstrapCommand(options.command),
				workingDirectory: options.workingDirectory
					? mapBootstrapPath(options.workingDirectory)
					: undefined,
			}),
		readTextFile: (options) =>
			session.readTextFile({
				...options,
				path: mapBootstrapPath(options.path),
			}),
		readBinaryFile: (options) =>
			session.readBinaryFile({
				...options,
				path: mapBootstrapPath(options.path),
			}),
		readFile: (options) =>
			session.readFile({
				...options,
				path: mapBootstrapPath(options.path),
			}),
		writeTextFile: (options) =>
			session.writeTextFile({
				...options,
				path: mapBootstrapPath(options.path),
			}),
		writeBinaryFile: (options) =>
			session.writeBinaryFile({
				...options,
				path: mapBootstrapPath(options.path),
			}),
		writeFile: (options) =>
			session.writeFile({
				...options,
				path: mapBootstrapPath(options.path),
			}),
	} as T;
}

function createMappedProvider(): HarnessV1SandboxProvider {
	const baseProvider = createLocalHostSandbox({
		workRoot: join(root, "work"),
		homeDir: join(root, "home"),
	});

	const mapNetworkSession = (
		session: HarnessV1NetworkSandboxSession,
	): HarnessV1NetworkSandboxSession => {
		const mapped = mapSession(session);
		return {
			...mapped,
			restricted: () => mapSession(session.restricted()),
		};
	};

	return {
		specificationVersion: "harness-sandbox-v1",
		providerId: "questpie-codex-compatibility-test",
		async createSession(options) {
			const session = await baseProvider.createSession({
				sessionId: options?.sessionId,
				abortSignal: options?.abortSignal,
				onFirstCreate: options?.onFirstCreate
					? (restricted, context) =>
							options.onFirstCreate!(mapSession(restricted), context)
					: undefined,
			});
			return mapNetworkSession(session);
		},
		async resumeSession(options) {
			const session = await baseProvider.resumeSession!(options);
			return mapNetworkSession(session);
		},
	};
}

async function runProcess(
	command: string,
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<ProcessResult> {
	const child = spawn(command, args, {
		cwd: options.cwd,
		env: options.env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	let timedOut = false;
	child.stdout.on("data", (data) => (stdout += String(data)));
	child.stderr.on("data", (data) => (stderr += String(data)));
	const timeout = setTimeout(() => {
		timedOut = true;
		child.kill("SIGTERM");
	}, options.timeoutMs);

	return new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (exitCode, signal) => {
			clearTimeout(timeout);
			resolve({
				exitCode,
				signal,
				stdout,
				stderr,
				timedOut,
				pid: child.pid,
			});
		});
	});
}

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "questpie-codex-compatibility-"));
	bootstrapRoot = join(root, "bootstrap");
	const candidate = await createQuestpieCodex({
		model: EXPLICIT_TEST_MODEL,
		auth: { openai: { apiKey: "" } },
	}).getBootstrap?.();
	if (!candidate) throw new Error("Codex bootstrap is missing");
	bootstrap = candidate;
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("Codex compatibility gate", () => {
	it("requires an explicit non-deprecated model", () => {
		expect(() => createQuestpieCodex({ model: "" })).toThrow(
			"requires an explicit model",
		);
		expect(() =>
			createQuestpieCodex({ model: DEPRECATED_CODEX_MODEL }),
		).toThrow("is deprecated");
	});

	it("accepts only normalized output that exactly equals the sentinel", () => {
		expect(
			isExactCodexSmokeOutput(` \n${CODEX_SMOKE_EXPECTED_OUTPUT}\r\n`),
		).toBe(true);
		expect(
			isExactCodexSmokeOutput(
				`The result mentions ${CODEX_SMOKE_EXPECTED_OUTPUT}.`,
			),
		).toBe(false);
		expect(isExactCodexSmokeOutput(undefined)).toBe(false);
	});

	it("removes staged credentials when setup fails", async () => {
		const setupRoot = join(root, "setup-failure");
		await mkdir(setupRoot, { recursive: true });

		await expect(
			runWithCodexSmokeCleanup(setupRoot, async () => {
				const authFile = join(setupRoot, "home/.codex/auth.json");
				await mkdir(join(setupRoot, "home/.codex"), { recursive: true });
				await writeFile(authFile, "protected-test-credential");
				throw new Error("simulated setup failure");
			}),
		).rejects.toThrow("simulated setup failure");
		expect(await pathExists(setupRoot)).toBe(false);
	});

	it("awaits idempotent teardown and removes staged auth on SIGTERM", async () => {
		const signalRoot = join(root, "signal-cleanup");
		const authDir = join(signalRoot, "home/.codex");
		await mkdir(authDir, { recursive: true });
		await writeFile(join(authDir, "auth.json"), "protected-test-credential");
		const signalTarget = new EventEmitter();
		let sessionCleanupCount = 0;
		let providerCleanupCount = 0;
		let exitCode: number | undefined;
		let resolveExit!: () => void;
		const exited = new Promise<void>((resolve) => (resolveExit = resolve));

		await runWithCodexSmokeCleanup(
			signalRoot,
			async (scope) => {
				scope.setSession({
					async destroy() {
						sessionCleanupCount += 1;
					},
				} as HarnessAgentSession);
				scope.setProviderCleanup(async () => {
					providerCleanupCount += 1;
				});
				signalTarget.emit("SIGTERM");
				await exited;
			},
			{
				signalTarget,
				exit(code) {
					exitCode = code;
					resolveExit();
				},
			},
		);

		expect(exitCode).toBe(143);
		expect(sessionCleanupCount).toBe(1);
		expect(providerCleanupCount).toBe(1);
		expect(await pathExists(signalRoot)).toBe(false);
	});

	it("owns exact adapter, SDK, CLI, and frozen Bun bootstrap provenance", async () => {
		expect(ADAPTER_VERSION).toBe(CODEX_ADAPTER_VERSION);
		expect(bootstrap!.harnessId).toBe("codex");
		expect(bootstrap!.commands.map(({ command }) => command)).toContain(
			`bun install --cwd ${UPSTREAM_BOOTSTRAP_DIR} --frozen-lockfile`,
		);
		expect(
			bootstrap!.files.some(({ path }) => path.endsWith("pnpm-lock.yaml")),
		).toBe(false);

		const manifest = bootstrap!.files.find(({ path }) =>
			path.endsWith("package.json"),
		)?.content;
		const lock = bootstrap!.files.find(({ path }) =>
			path.endsWith("bun.lock"),
		)?.content;
		expect(manifest).toContain(`"@openai/codex-sdk": "${CODEX_SDK_VERSION}"`);
		expect(lock).toContain(`@openai/codex-sdk@${CODEX_SDK_VERSION}`);
		expect(lock).toContain(`@openai/codex@${CODEX_CLI_VERSION}`);
		expect(`${manifest}\n${lock}`).not.toContain("0.130.0");
		expect(`${manifest}\n${lock}`).not.toContain(DEPRECATED_CODEX_MODEL);
	});

	it("installs the full frozen bootstrap and starts the exact native CLI", async () => {
		for (const file of bootstrap!.files) {
			await Bun.write(mapBootstrapPath(file.path), file.content);
		}
		for (const { command } of bootstrap!.commands) {
			const result = await runProcess(
				"bash",
				["-lc", mapBootstrapCommand(command)],
				{ timeoutMs: 20_000 },
			);
			expect(result).toMatchObject({
				exitCode: 0,
				signal: null,
				timedOut: false,
			});
		}

		const sdkPackage = JSON.parse(
			await readFile(
				join(bootstrapRoot, "node_modules/@openai/codex-sdk/package.json"),
				"utf8",
			),
		) as { version: string };
		expect(sdkPackage.version).toBe(CODEX_SDK_VERSION);

		const versionHome = join(root, "version-home");
		await mkdir(join(versionHome, ".codex"), { recursive: true });
		const cli = await runProcess(
			"node",
			[
				join(bootstrapRoot, "node_modules/@openai/codex/bin/codex.js"),
				"--version",
			],
			{
				env: {
					PATH: process.env.PATH,
					HOME: versionHome,
					CODEX_HOME: join(versionHome, ".codex"),
				},
				timeoutMs: 15_000,
			},
		);
		expect(cli).toMatchObject({ exitCode: 0, signal: null, timedOut: false });
		expect(cli.stderr).toBe("");
		expect(cli.stdout).toContain(CODEX_CLI_VERSION);
	});

	it("starts and tears down the full Harness bridge without credentials", async () => {
		const agent = new HarnessAgent({
			harness: createQuestpieCodex({
				model: EXPLICIT_TEST_MODEL,
				auth: { openai: { apiKey: "" } },
				startupTimeoutMs: 10_000,
			}),
			sandbox: createMappedProvider(),
			permissionMode: "allow-all",
		});
		const session = await agent.createSession({
			sessionId: "credential-free-bootstrap",
		});

		expect(session.sessionId).toBe("credential-free-bootstrap");
		await session.destroy();
	});

	it("reports timeout signals and leaves no child process behind", async () => {
		const result = await runProcess(
			process.execPath,
			["-e", "setInterval(() => {}, 1000)"],
			{ timeoutMs: 50 },
		);
		expect(result.exitCode).toBeNull();
		expect(result.signal).toBe("SIGTERM");
		expect(result.timedOut).toBe(true);
		if (result.pid) {
			expect(() => process.kill(result.pid!, 0)).toThrow();
		}
	});
});
