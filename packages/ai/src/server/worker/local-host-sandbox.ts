import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname } from "node:path";
import { Readable } from "node:stream";

import type {
	HarnessV1NetworkSandboxSession,
	HarnessV1SandboxProvider,
} from "@ai-sdk/harness";
import type {
	Experimental_SandboxProcess,
	Experimental_SandboxSession,
} from "@ai-sdk/provider-utils";

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

function makeBaseSession(options: {
	cwd: string;
	homeDir: string;
	trackChild: (child: ChildProcess) => void;
}): Experimental_SandboxSession {
	const { cwd, homeDir, trackChild } = options;
	const baseEnv = { ...process.env, HOME: homeDir };
	const resolveCwd = (workingDirectory?: string) => workingDirectory ?? cwd;

	return {
		description: `local-host sandbox (cwd=${cwd}, home=${homeDir})`,
		async run({ command, workingDirectory, env, abortSignal }) {
			const child = nodeSpawn("bash", ["-lc", command], {
				cwd: resolveCwd(workingDirectory),
				env: { ...baseEnv, ...(env ?? {}) },
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
				env: { ...baseEnv, ...(env ?? {}) },
				signal: abortSignal,
			});
			trackChild(child);

			return {
				pid: child.pid,
				stdout: Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>,
				stderr: Readable.toWeb(child.stderr!) as unknown as ReadableStream<Uint8Array>,
				wait: () =>
					new Promise<{ exitCode: number }>((resolve) => {
						child.on("close", (code) => resolve({ exitCode: code ?? 0 }));
						child.on("error", () => resolve({ exitCode: 127 }));
					}),
				async kill() {
					child.kill();
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

export function createLocalHostSandbox(settings: {
	workRoot: string;
	homeDir?: string;
}): HarnessV1SandboxProvider {
	const homeDir = settings.homeDir ?? process.env.HOME;
	if (!homeDir) throw new Error("HOME is required for local-host sandbox");

	return {
		specificationVersion: "harness-sandbox-v1",
		providerId: "questpie-local-host",
		async createSession(options) {
			const port = await freePort();
			const id = options?.sessionId ?? `local_${randomUUID().slice(0, 8)}`;
			const cwd = settings.workRoot;
			await mkdir(cwd, { recursive: true });

			const children: ChildProcess[] = [];
			const base = makeBaseSession({
				cwd,
				homeDir,
				trackChild: (child) => children.push(child),
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
				async stop() {
					for (const child of children) {
						try {
							child.kill();
						} catch {}
					}
				},
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
