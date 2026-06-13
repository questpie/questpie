import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";

import type {
	HarnessV1NetworkSandboxSession,
	HarnessV1SandboxProvider,
} from "@ai-sdk/harness";
import type {
	Experimental_SandboxProcess,
	Experimental_SandboxSession,
} from "@ai-sdk/provider-utils";

const DEFAULT_ENV_ALLOWLIST = [
	"PATH",
	"SHELL",
	"USER",
	"LOGNAME",
	"TMPDIR",
	"TEMP",
	"TMP",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TERM",
	"CI",
	"BUN_INSTALL",
	"PNPM_HOME",
	"COREPACK_HOME",
] as const;

const SECRET_ENV_PATTERN =
	/(^|_)(TOKEN|SECRET|KEY|PASSWORD|PASS|PWD|CREDENTIAL|AUTH|COOKIE|SESSION)($|_)/i;

export interface LocalHostSandboxSettings {
	workRoot: string;
	/**
	 * Isolated HOME root. Defaults to `<workRoot>/.questpie/local-host-home/<sessionId>`.
	 */
	homeDir?: string | ((sessionId: string) => string);
	/** Extra non-secret host env names to copy into spawned commands. */
	envAllowlist?: readonly string[];
	/** Baseline env for every command. Explicit per-command env still wins. */
	env?: Record<string, string>;
	/**
	 * Explicit escape hatch for local auth while the claude-code bridge still reads
	 * credentials from ~/.claude. This weakens HOME isolation because bridge config
	 * and skills also write under the auth HOME. Follow-up credential provisioning
	 * should replace this with a narrow credential mount/copy seam.
	 */
	passthroughHomeForAuth?: boolean;
	/** HOME to use when passthroughHomeForAuth is enabled. Defaults to process.env.HOME. */
	authHome?: string;
}

function isENOENT(error: unknown) {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	);
}

async function freePort() {
	return new Promise<number>((resolve, reject) => {
		const server = createServer();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close(() => resolve(port));
		});
	});
}

function isSecretEnvName(name: string) {
	return SECRET_ENV_PATTERN.test(name);
}

function copyAllowedHostEnv(allowlist: readonly string[]) {
	const env: Record<string, string> = {};
	for (const name of allowlist) {
		const value = process.env[name];
		if (value === undefined || isSecretEnvName(name)) continue;
		env[name] = value;
	}
	return env;
}

function sanitizeExplicitEnv(env: Record<string, string> | undefined) {
	const clean: Record<string, string> = {};
	for (const [name, value] of Object.entries(env ?? {})) {
		if (value === undefined) continue;
		clean[name] = value;
	}
	return clean;
}

function makeSpawnEnv(options: {
	homeDir: string;
	envAllowlist: readonly string[];
	baseEnv?: Record<string, string>;
	commandEnv?: Record<string, string>;
}) {
	const { homeDir, envAllowlist, baseEnv, commandEnv } = options;
	const xdgConfigHome = join(homeDir, ".config");
	const xdgCacheHome = join(homeDir, ".cache");
	return {
		...copyAllowedHostEnv(envAllowlist),
		...sanitizeExplicitEnv(baseEnv),
		HOME: homeDir,
		XDG_CONFIG_HOME: xdgConfigHome,
		XDG_CACHE_HOME: xdgCacheHome,
		...sanitizeExplicitEnv(commandEnv),
	};
}

function killChild(child: ChildProcess) {
	if (child.killed || child.exitCode !== null || child.signalCode !== null) return;
	try {
		if (process.platform !== "win32" && child.pid) {
			process.kill(-child.pid);
			return;
		}
		child.kill();
	} catch {}
}

function makeBaseSession(options: {
	cwd: string;
	homeDir: string;
	envAllowlist: readonly string[];
	baseEnv?: Record<string, string>;
	trackChild: (child: ChildProcess) => void;
}): Experimental_SandboxSession {
	const { cwd, homeDir, envAllowlist, baseEnv, trackChild } = options;
	const resolveCwd = (workingDirectory?: string) => workingDirectory ?? cwd;
	const envFor = (commandEnv?: Record<string, string>) =>
		makeSpawnEnv({ homeDir, envAllowlist, baseEnv, commandEnv });

	return {
		description: `local-host sandbox (cwd=${cwd}, home=${homeDir})`,
		async run({ command, workingDirectory, env, abortSignal }) {
			const child = nodeSpawn("bash", ["-lc", command], {
				cwd: resolveCwd(workingDirectory),
				detached: process.platform !== "win32",
				env: envFor(env),
				signal: abortSignal,
			});
			trackChild(child);

			let stdout = "";
			let stderr = "";
			child.stdout?.on("data", (data) => {
				stdout += data;
			});
			child.stderr?.on("data", (data) => {
				stderr += data;
			});

			const exitCode = await new Promise<number>((resolve) => {
				child.on("close", (code) => resolve(code ?? 0));
				child.on("error", () => resolve(127));
			});
			return { exitCode, stdout, stderr };
		},
		async spawn({ command, workingDirectory, env, abortSignal }) {
			const child = nodeSpawn("bash", ["-lc", command], {
				cwd: resolveCwd(workingDirectory),
				detached: process.platform !== "win32",
				env: envFor(env),
				signal: abortSignal,
			});
			trackChild(child);

			let waitPromise: Promise<{ exitCode: number }> | undefined;
			const wait = () => {
				waitPromise ??= new Promise<{ exitCode: number }>((resolve) => {
					child.on("close", (code) => resolve({ exitCode: code ?? 0 }));
					child.on("error", () => resolve({ exitCode: 127 }));
				});
				return waitPromise;
			};

			return {
				pid: child.pid,
				stdout: Readable.toWeb(
					child.stdout!,
				) as unknown as ReadableStream<Uint8Array>,
				stderr: Readable.toWeb(
					child.stderr!,
				) as unknown as ReadableStream<Uint8Array>,
				wait,
				async kill() {
					killChild(child);
				},
			} satisfies Experimental_SandboxProcess;
		},
		async readTextFile({ path, encoding }) {
			try {
				return await readFile(path, (encoding ?? "utf8") as BufferEncoding);
			} catch (error) {
				if (isENOENT(error)) return null;
				throw error;
			}
		},
		async readBinaryFile({ path }) {
			try {
				return new Uint8Array(await readFile(path));
			} catch (error) {
				if (isENOENT(error)) return null;
				throw error;
			}
		},
		async readFile({ path }) {
			try {
				return new Response(await readFile(path)).body;
			} catch (error) {
				if (isENOENT(error)) return null;
				throw error;
			}
		},
		async writeTextFile({ path, content, encoding }) {
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, content, (encoding ?? "utf8") as BufferEncoding);
		},
		async writeBinaryFile({ path, content }) {
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, content);
		},
		async writeFile({ path, content }) {
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, Buffer.from(await new Response(content).arrayBuffer()));
		},
	};
}

function resolveHomeDir(settings: LocalHostSandboxSettings, sessionId: string) {
	if (settings.passthroughHomeForAuth) {
		const authHome = settings.authHome ?? process.env.HOME;
		if (!authHome) throw new Error("authHome or HOME is required for auth passthrough");
		return authHome;
	}
	if (typeof settings.homeDir === "function") return settings.homeDir(sessionId);
	return settings.homeDir ?? join(settings.workRoot, ".questpie", "local-host-home", sessionId);
}

export function createLocalHostSandbox(
	settings: LocalHostSandboxSettings,
): HarnessV1SandboxProvider {
	return {
		specificationVersion: "harness-sandbox-v1",
		providerId: "questpie-local-host",
		async createSession(options) {
			const port = await freePort();
			const id = options?.sessionId ?? `local_${randomUUID().slice(0, 8)}`;
			const cwd = settings.workRoot;
			const homeDir = resolveHomeDir(settings, id);
			await mkdir(cwd, { recursive: true });
			await mkdir(homeDir, { recursive: true });

			const children = new Set<ChildProcess>();
			let destroyed = false;
			const cleanup = async () => {
				if (destroyed) return;
				destroyed = true;
				for (const child of children) killChild(child);
				children.clear();
			};
			const base = makeBaseSession({
				cwd,
				homeDir,
				envAllowlist: [
					...DEFAULT_ENV_ALLOWLIST,
					...(settings.envAllowlist ?? []),
				],
				baseEnv: settings.env,
				trackChild: (child) => {
					children.add(child);
					child.once("close", () => children.delete(child));
					child.once("error", () => children.delete(child));
					if (destroyed) killChild(child);
				},
			});
			const session: HarnessV1NetworkSandboxSession = {
				...base,
				id,
				defaultWorkingDirectory: cwd,
				ports: [port],
				async getPortUrl({ port: requestedPort, protocol }) {
					const scheme = protocol === "ws" ? "ws" : "http";
					return `${scheme}://127.0.0.1:${requestedPort}`;
				},
				stop: cleanup,
				destroy: cleanup,
				restricted() {
					return base;
				},
			};

			if (options?.onFirstCreate) {
				await options.onFirstCreate(base, {
					abortSignal: options.abortSignal,
				});
			}

			return session;
		},
	};
}
