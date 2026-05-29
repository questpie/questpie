import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Readable, Writable } from "node:stream";

import * as acp from "@agentclientprotocol/sdk";

import type {
	SpawnAgentRunHandle,
	SpawnAgentRunner,
	SpawnAgentRunRequest,
} from "../modules/ai/lib/execution-contract.js";

const acpRequire = createRequire(import.meta.url);

export type DirectSpawnRuntime = "claude-code" | "codex";

export interface DirectSpawnRuntimeConfig {
	runtime: DirectSpawnRuntime;
	binaryPath?: string;
	adapterCommand?: string;
	adapterArgs?: string[];
}

export interface DirectSpawnRunnerConfig {
	workerDir: string;
	runtimes: DirectSpawnRuntimeConfig[];
	mcpServers?: unknown[];
}

export interface PreparedWorkerVolume {
	workerDir: string;
	volumeId: string;
}

interface EventStream {
	events: AsyncIterable<Record<string, unknown>>;
	emit(event: Record<string, unknown>): void;
	close(): void;
}

export async function prepareWorkerVolume(
	workerDir: string,
): Promise<PreparedWorkerVolume> {
	await mkdir(join(workerDir, "homes"), { recursive: true });
	await mkdir(join(workerDir, "homes", "claude-code", ".claude", "skills"), {
		recursive: true,
	});
	await mkdir(join(workerDir, "worker"), { recursive: true });

	const volumeIdPath = join(workerDir, "worker", "volume-id");
	let volumeId = "";
	try {
		volumeId = (await readFile(volumeIdPath, "utf-8")).trim();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}

	if (!volumeId) {
		volumeId = `vol_${randomUUID().slice(0, 12)}`;
		await writeFile(volumeIdPath, volumeId);
	}

	return { workerDir, volumeId };
}

export function createSpawnAgentRunner(
	config: DirectSpawnRunnerConfig,
): SpawnAgentRunner {
	const runtimeConfigs = new Map(
		config.runtimes.map((runtimeConfig) => [
			runtimeConfig.runtime,
			runtimeConfig,
		]),
	);

	return {
		async run(input: SpawnAgentRunRequest): Promise<SpawnAgentRunHandle> {
			const commandId = `cmd_${randomUUID().slice(0, 12)}`;
			const stream = createEventStream();
			const completion = runSpawnAgentCommand({
				...input,
				commandId,
				workerDir: config.workerDir,
				mcpServers: mergeMcpServers(config.mcpServers, input.mcpServers),
				runtimeConfig: runtimeConfigs.get(input.runtime as DirectSpawnRuntime),
				stream,
			});

			return {
				events: stream.events,
				completion,
			};
		},
	};
}

function createEventStream(): EventStream {
	const queue: Record<string, unknown>[] = [];
	let closed = false;
	let waiting:
		| ((result: IteratorResult<Record<string, unknown>>) => void)
		| null = null;

	return {
		events: {
			[Symbol.asyncIterator]() {
				return {
					next(): Promise<IteratorResult<Record<string, unknown>>> {
						const event = queue.shift();
						if (event) return Promise.resolve({ value: event, done: false });
						if (closed) {
							return Promise.resolve({
								value: undefined as never,
								done: true,
							});
						}
						return new Promise((resolve) => {
							waiting = resolve;
						});
					},
				};
			},
		},

		emit(event: Record<string, unknown>) {
			if (closed) return;
			if (waiting) {
				const resolve = waiting;
				waiting = null;
				resolve({ value: event, done: false });
				return;
			}
			queue.push(event);
		},

		close() {
			if (closed) return;
			closed = true;
			if (waiting) {
				const resolve = waiting;
				waiting = null;
				resolve({ value: undefined as never, done: true });
			}
		},
	};
}

async function runSpawnAgentCommand(
	input: {
		commandId: string;
		workerDir: string;
		runtimeConfig?: DirectSpawnRuntimeConfig;
		stream: EventStream;
	} & SpawnAgentRunRequest,
): Promise<Record<string, unknown>> {
	const runtime = requireDirectRuntime(input.runtime);
	const runtimeConfig = input.runtimeConfig ?? { runtime };
	const adapter = acpAdapterCommand(runtime, runtimeConfig);
	const env = {
		...process.env,
		...buildIsolatedEnvRecord(input.workerDir, runtime),
	};
	const agentProcess = spawn(adapter.command, adapter.args, {
		cwd: input.cwd,
		env,
		stdio: ["pipe", "pipe", "pipe"],
	});

	const stderrChunks: string[] = [];
	agentProcess.stderr.on("data", (chunk) => {
		const text = String(chunk);
		stderrChunks.push(text);
		input.stream.emit({
			type: "agent.stderr",
			commandId: input.commandId,
			text,
		});
	});

	// Surface spawn failures (e.g. ENOENT) and premature exits instead of
	// crashing the worker (an unhandled "error" event is fatal in Bun) or
	// hanging the ACP calls forever (the connection never rejects on close).
	const processFailed = new Promise<never>((_, reject) => {
		agentProcess.once("error", (error) =>
			reject(error instanceof Error ? error : new Error(String(error))),
		);
		agentProcess.once("exit", (code, signal) => {
			if (typeof code === "number" && code !== 0) {
				reject(new Error(`${adapter.command} exited with code ${code}`));
			} else if (signal) {
				reject(new Error(`${adapter.command} terminated with ${signal}`));
			}
		});
	});
	processFailed.catch(() => {});
	const untilFailure = <T>(promise: Promise<T>): Promise<T> =>
		Promise.race([promise, processFailed]);

	try {
		input.stream.emit({
			type: "command.started",
			commandId: input.commandId,
			runtime,
			adapter: adapter.command,
		});

		const runState = {
			totalText: "",
			totalThinking: "",
			costAmount: undefined as number | undefined,
		};
		const client = createAcpClient(input, runState);
		const transport = acp.ndJsonStream(
			Writable.toWeb(agentProcess.stdin),
			Readable.toWeb(agentProcess.stdout) as unknown as ReadableStream<
				Uint8Array<ArrayBufferLike>
			>,
		);
		const connection = new acp.ClientSideConnection(() => client, transport);
		const initialized = await untilFailure(
			connection.initialize({
				protocolVersion: acp.PROTOCOL_VERSION,
				clientInfo: { name: "questpie-ai-worker", version: "0.1.0" },
				clientCapabilities: {
					fs: { readTextFile: false, writeTextFile: false },
					terminal: false,
				},
			}),
		);
		const mcpServers = normalizeMcpServers(input.mcpServers) as acp.McpServer[];
		const session = await untilFailure(
			resolveAcpSession({
				connection,
				cwd: input.cwd ?? process.cwd(),
				mcpServers,
				runtimeSessionRef: input.runtimeSessionRef,
				systemPrompt: input.systemPrompt,
				canLoadSession: Boolean(initialized.agentCapabilities?.loadSession),
			}),
		);

		input.stream.emit({
			type: "session.resolved",
			commandId: input.commandId,
			sessionRef: session.sessionId,
			isNew: session.isNew,
		});

		const promptResult = await untilFailure(
			connection.prompt({
				sessionId: session.sessionId,
				prompt: [{ type: "text", text: input.prompt }],
			}),
		);
		const usage = promptResult.usage;
		const result = {
			text: runState.totalText,
			thinking: runState.totalThinking || undefined,
			sessionRef: session.sessionId,
			inputTokens: usage?.inputTokens ?? 0,
			outputTokens: usage?.outputTokens ?? 0,
			cost: runState.costAmount,
			stopReason: promptResult.stopReason ?? "end_turn",
		};

		input.stream.emit({
			type: "command.completed",
			commandId: input.commandId,
			result,
		});
		return result;
	} catch (error) {
		if (stderrChunks.length > 0 && error instanceof Error) {
			error.message = `${error.message}\n${stderrChunks.join("").trim()}`;
		}
		throw error;
	} finally {
		agentProcess.kill();
		input.stream.close();
	}
}

function requireDirectRuntime(runtime: string): DirectSpawnRuntime {
	if (runtime === "claude-code" || runtime === "codex") return runtime;
	throw new Error(`Unsupported spawn-agent runtime "${runtime}"`);
}

function resolveAcpAdapter(
	pkg: string,
): { command: string; args: string[] } | null {
	try {
		const pkgJsonPath = acpRequire.resolve(`${pkg}/package.json`);
		const manifest = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
			bin?: string | Record<string, string>;
		};
		const bin =
			typeof manifest.bin === "string"
				? manifest.bin
				: Object.values(manifest.bin ?? {})[0];
		if (!bin) return null;
		// Run the adapter CLI with the current runtime so execution does not
		// depend on the adapter binary being on PATH — it only lives in the
		// package's own node_modules/.bin.
		return {
			command: process.execPath,
			args: [join(dirname(pkgJsonPath), bin)],
		};
	} catch {
		return null;
	}
}

function acpAdapterCommand(
	runtime: DirectSpawnRuntime,
	runtimeConfig: DirectSpawnRuntimeConfig,
) {
	if (runtimeConfig.adapterCommand) {
		return {
			command: runtimeConfig.adapterCommand,
			args: runtimeConfig.adapterArgs ?? [],
		};
	}
	if (runtimeConfig.binaryPath) {
		return {
			command: runtimeConfig.binaryPath,
			args: runtimeConfig.adapterArgs ?? [],
		};
	}
	const pkg =
		runtime === "codex"
			? "@agentclientprotocol/codex-acp"
			: "@agentclientprotocol/claude-agent-acp";
	return (
		resolveAcpAdapter(pkg) ??
		(runtime === "codex"
			? { command: "codex-acp", args: [] }
			: { command: "claude-agent-acp", args: [] })
	);
}

function createAcpClient(
	input: {
		commandId: string;
		stream: EventStream;
	},
	runState: {
		totalText: string;
		totalThinking: string;
		costAmount: number | undefined;
	},
) {
	return {
		async requestPermission(params: acp.RequestPermissionRequest) {
			const option =
				params.options.find((item) => item.kind === "allow_always") ??
				params.options.find((item) => item.kind === "allow_once") ??
				params.options[0];

			input.stream.emit({
				type: "permission.requested",
				commandId: input.commandId,
				tool: params.toolCall.title,
				options: params.options,
				selectedOptionId: option?.optionId ?? null,
			});

			if (!option) {
				return { outcome: { outcome: "cancelled" as const } };
			}

			return {
				outcome: {
					outcome: "selected" as const,
					optionId: option.optionId,
				},
			};
		},

		async sessionUpdate(params: acp.SessionNotification) {
			const update = params.update;
			switch (update.sessionUpdate) {
				case "agent_message_chunk":
					if (update.content.type === "text") {
						runState.totalText += update.content.text;
						input.stream.emit({
							type: "text.delta",
							commandId: input.commandId,
							text: update.content.text,
						});
					}
					break;
				case "agent_thought_chunk":
					if (update.content.type === "text") {
						runState.totalThinking += update.content.text;
						input.stream.emit({
							type: "thinking.delta",
							commandId: input.commandId,
							text: update.content.text,
						});
					}
					break;
				case "tool_call":
					input.stream.emit({
						type: "tool.started",
						commandId: input.commandId,
						tool: update.title,
						toolCallId: update.toolCallId,
						input: update.rawInput,
						status: update.status,
					});
					break;
				case "tool_call_update":
					input.stream.emit({
						type: "tool.update",
						commandId: input.commandId,
						tool: update.toolCallId,
						status: update.status,
						output: update.rawOutput,
					});
					break;
				case "usage_update":
					runState.costAmount = update.cost?.amount ?? runState.costAmount;
					input.stream.emit({
						type: "usage.update",
						commandId: input.commandId,
						used: update.used,
						size: update.size,
						cost: update.cost?.amount ?? undefined,
					});
					break;
				case "plan":
					input.stream.emit({
						type: "plan.update",
						commandId: input.commandId,
						entries: update.entries,
					});
					break;
			}
		},
	};
}

async function resolveAcpSession(input: {
	connection: acp.ClientSideConnection;
	cwd: string;
	mcpServers: acp.McpServer[];
	runtimeSessionRef?: string;
	systemPrompt?: string;
	canLoadSession: boolean;
}) {
	const meta = input.systemPrompt
		? { systemPrompt: input.systemPrompt }
		: undefined;
	if (input.runtimeSessionRef && input.canLoadSession) {
		await input.connection.loadSession({
			sessionId: input.runtimeSessionRef,
			cwd: input.cwd,
			mcpServers: input.mcpServers,
			_meta: meta,
		});
		return { sessionId: input.runtimeSessionRef, isNew: false };
	}

	const session = await input.connection.newSession({
		cwd: input.cwd,
		mcpServers: input.mcpServers,
		_meta: meta,
	});
	return { sessionId: session.sessionId, isNew: true };
}

function buildIsolatedEnvRecord(
	workerDir: string,
	runtime: DirectSpawnRuntime,
): Record<string, string> {
	if (runtime === "codex") {
		return { CODEX_HOME: join(workerDir, "homes", "codex") };
	}

	return {
		HOME: join(workerDir, "homes", "claude-code"),
		CLAUDE_CONFIG_DIR: join(workerDir, "homes", "claude-code", "config"),
		CLAUDE_DATA_DIR: join(workerDir, "homes", "claude-code", "data"),
	};
}

function mergeMcpServers(
	globalServers: unknown[] | undefined,
	runServers: unknown[] | undefined,
): unknown[] {
	return [
		...(Array.isArray(globalServers) ? globalServers : []),
		...(Array.isArray(runServers) ? runServers : []),
	];
}

function normalizeMcpServers(value: unknown[] | undefined): unknown[] {
	if (!Array.isArray(value)) return [];
	return value.map((server) => {
		if (!isRecord(server)) return server;
		if (typeof server.url === "string") {
			return {
				type: "http",
				name: server.name,
				url: server.url,
				headers: entriesFromRecord(server.headers),
			};
		}
		return {
			name: server.name,
			command: server.command,
			args: Array.isArray(server.args) ? [...server.args] : [],
			env: entriesFromRecord(server.env),
		};
	});
}

function entriesFromRecord(value: unknown) {
	if (!isRecord(value)) return [];
	return Object.entries(value)
		.filter((entry): entry is [string, string] => typeof entry[1] === "string")
		.map(([name, entryValue]) => ({ name, value: entryValue }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
