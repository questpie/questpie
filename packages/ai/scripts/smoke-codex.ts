import { chmod, copyFile, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
	HarnessV1NetworkSandboxSession,
	HarnessV1SandboxProvider,
} from "@ai-sdk/harness";
import { HarnessAgent } from "@ai-sdk/harness/agent";
import type { Experimental_SandboxSession } from "@ai-sdk/provider-utils";

import { createQuestpieCodex } from "../src/server/modules/ai/lib/codex-compatibility.js";
import {
	CODEX_SMOKE_EXPECTED_OUTPUT,
	isExactCodexSmokeOutput,
	runWithCodexSmokeCleanup,
} from "../src/server/modules/ai/lib/codex-smoke-safety.js";
import { createLocalHostSandbox } from "../src/server/worker/local-host-sandbox.js";

const UPSTREAM_BOOTSTRAP_DIR = "/tmp/harness/codex";

function requiredEnv(name: string) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is required`);
	return value;
}

function mapSession<T extends Experimental_SandboxSession>(
	session: T,
	bootstrapRoot: string,
): T {
	const mapPath = (path: string) => {
		if (path === UPSTREAM_BOOTSTRAP_DIR) return bootstrapRoot;
		if (path.startsWith(`${UPSTREAM_BOOTSTRAP_DIR}/`)) {
			return join(bootstrapRoot, path.slice(UPSTREAM_BOOTSTRAP_DIR.length + 1));
		}
		return path;
	};
	const mapCommand = (command: string) =>
		command.replaceAll(UPSTREAM_BOOTSTRAP_DIR, bootstrapRoot);

	return {
		...session,
		run: (options) =>
			session.run({
				...options,
				command: mapCommand(options.command),
				workingDirectory: options.workingDirectory
					? mapPath(options.workingDirectory)
					: undefined,
			}),
		spawn: (options) =>
			session.spawn({
				...options,
				command: mapCommand(options.command),
				workingDirectory: options.workingDirectory
					? mapPath(options.workingDirectory)
					: undefined,
			}),
		readTextFile: (options) =>
			session.readTextFile({ ...options, path: mapPath(options.path) }),
		readBinaryFile: (options) =>
			session.readBinaryFile({ ...options, path: mapPath(options.path) }),
		readFile: (options) =>
			session.readFile({ ...options, path: mapPath(options.path) }),
		writeTextFile: (options) =>
			session.writeTextFile({ ...options, path: mapPath(options.path) }),
		writeBinaryFile: (options) =>
			session.writeBinaryFile({ ...options, path: mapPath(options.path) }),
		writeFile: (options) =>
			session.writeFile({ ...options, path: mapPath(options.path) }),
	} as T;
}

function createIsolatedProvider(options: { root: string; home: string }): {
	provider: HarnessV1SandboxProvider;
	cleanup: () => Promise<void>;
} {
	const baseProvider = createLocalHostSandbox({
		workRoot: join(options.root, "work"),
		homeDir: options.home,
	});
	const bootstrapRoot = join(options.root, "bootstrap");
	const sessions = new Set<HarnessV1NetworkSandboxSession>();
	let closing = false;
	let cleanupPromise: Promise<void> | undefined;
	const mapNetworkSession = (
		session: HarnessV1NetworkSandboxSession,
	): HarnessV1NetworkSandboxSession => {
		const mapped = mapSession(session, bootstrapRoot);
		return {
			...mapped,
			restricted: () => mapSession(session.restricted(), bootstrapRoot),
		};
	};

	return {
		provider: {
			specificationVersion: "harness-sandbox-v1",
			providerId: "questpie-protected-codex-smoke",
			async createSession(sessionOptions) {
				const session = await baseProvider.createSession({
					sessionId: sessionOptions?.sessionId,
					abortSignal: sessionOptions?.abortSignal,
				});
				if (closing) {
					await session.destroy();
					throw new Error("Codex smoke provider is closing");
				}
				sessions.add(session);
				await sessionOptions?.onFirstCreate?.(
					mapSession(session.restricted(), bootstrapRoot),
					{ abortSignal: sessionOptions.abortSignal },
				);
				return mapNetworkSession(session);
			},
			async resumeSession(sessionOptions) {
				const session = await baseProvider.resumeSession!(sessionOptions);
				if (closing) {
					await session.destroy();
					throw new Error("Codex smoke provider is closing");
				}
				sessions.add(session);
				return mapNetworkSession(session);
			},
		},
		cleanup() {
			cleanupPromise ??= (async () => {
				closing = true;
				await Promise.allSettled(
					[...sessions].map((session) => session.destroy()),
				);
				sessions.clear();
			})();
			return cleanupPromise;
		},
	};
}

async function main() {
	if (process.env.AUTOPILOT_REAL_CODEX_SMOKE !== "1") {
		throw new Error("AUTOPILOT_REAL_CODEX_SMOKE=1 is required");
	}
	const model = requiredEnv("AUTOPILOT_CODEX_MODEL");
	const authFile = requiredEnv("AUTOPILOT_CODEX_AUTH_FILE");
	const auth = await readFile(authFile, "utf8").catch(() => "");
	if (!auth.trim()) throw new Error("isolated Codex auth file is unreadable");
	try {
		const parsed = JSON.parse(auth) as unknown;
		if (!parsed || typeof parsed !== "object") throw new Error();
	} catch {
		throw new Error("isolated Codex auth file is invalid");
	}

	const root = await mkdtemp(join(tmpdir(), "questpie-real-codex-smoke-"));
	await runWithCodexSmokeCleanup(root, async (scope) => {
		const home = join(root, "home");
		const codexHome = join(home, ".codex");
		await mkdir(codexHome, { recursive: true, mode: 0o700 });
		const isolatedAuthFile = join(codexHome, "auth.json");
		await copyFile(authFile, isolatedAuthFile);
		await chmod(isolatedAuthFile, 0o600);

		const isolatedProvider = createIsolatedProvider({ root, home });
		scope.setProviderCleanup(isolatedProvider.cleanup);
		const timeout = setTimeout(() => void scope.cleanup(), 180_000);
		const agent = new HarnessAgent({
			harness: createQuestpieCodex({
				model,
				// Empty explicit API key prevents accidental parent-process env fallback;
				// the copied auth.json is the only credential source for this run.
				auth: { openai: { apiKey: "" } },
				startupTimeoutMs: 30_000,
			}),
			sandbox: isolatedProvider.provider,
			permissionMode: "allow-all",
		});
		try {
			const session = await agent.createSession({
				sessionId: "protected-codex-smoke",
				abortSignal: scope.abortSignal,
			});
			scope.setSession(session);
			const result = await agent.generate({
				session,
				prompt: `Reply with exactly ${CODEX_SMOKE_EXPECTED_OUTPUT}. Do not use tools.`,
				abortSignal: scope.abortSignal,
			});
			if (!isExactCodexSmokeOutput(result.text)) {
				throw new Error(
					"Codex smoke completed without the exact expected output",
				);
			}
			console.log(`Codex protected smoke passed with explicit model ${model}.`);
		} finally {
			clearTimeout(timeout);
		}
	});
}

await main().catch((error) => {
	const safeInputErrors = new Set([
		"AUTOPILOT_REAL_CODEX_SMOKE=1 is required",
		"AUTOPILOT_CODEX_MODEL is required",
		"AUTOPILOT_CODEX_AUTH_FILE is required",
		"isolated Codex auth file is unreadable",
		"isolated Codex auth file is invalid",
		"Codex smoke completed without the exact expected output",
	]);
	const message = error instanceof Error ? error.message : "";
	console.error(
		safeInputErrors.has(message)
			? message
			: "Codex protected smoke failed before verified output.",
	);
	process.exitCode = 1;
});
