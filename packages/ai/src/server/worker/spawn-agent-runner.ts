import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
	SpawnAgentRunHandle,
	SpawnAgentRunner,
	SpawnAgentRunRequest,
} from "../modules/ai/lib/execution-contract.js";

export type DirectSpawnRuntime = "claude-code" | "codex";

export interface DirectSpawnRuntimeConfig {
	runtime: DirectSpawnRuntime;
	binaryPath?: string;
}

export interface DirectSpawnRunnerConfig {
	workerDir: string;
	runtimes: DirectSpawnRuntimeConfig[];
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
	await mkdir(join(workerDir, "worker"), { recursive: true });

	const volumeIdPath = join(workerDir, "worker", "volume-id");
	let volumeId = "";
	try {
		volumeId = (await readFile(volumeIdPath, "utf-8")).trim();
	} catch {}

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
	try {
		const runtime = requireDirectRuntime(input.runtime);
		const runtimeConfig = input.runtimeConfig ?? { runtime };
		const { SpawnAgent, autoAllow } = await import("spawn-agent");
		const { claude, codex } = await import("spawn-agent/adapters");
		const adapter =
			runtime === "codex"
				? codex({ binPath: runtimeConfig.binaryPath ?? "codex" })
				: claude({ binPath: runtimeConfig.binaryPath ?? "claude" });
		const mcpServers = normalizeMcpServers(input.mcpServers) as any;
		const agent = await SpawnAgent.connect(adapter, {
			env: buildIsolatedEnvRecord(input.workerDir, runtime),
			cwd: input.cwd,
			permission: autoAllow,
			mcpServers,
			systemPrompt: input.systemPrompt,
		});

		try {
			input.stream.emit({
				type: "command.started",
				commandId: input.commandId,
				runtime,
			});

			const sessionId = input.runtimeSessionRef
				? await agent.resumeSession({
						sessionId: input.runtimeSessionRef as never,
						cwd: input.cwd,
						mcpServers,
					})
				: await agent.createSession({
						cwd: input.cwd,
						mcpServers,
						systemPrompt: input.systemPrompt,
					});

			input.stream.emit({
				type: "session.resolved",
				commandId: input.commandId,
				sessionRef: sessionId as string,
				isNew: !input.runtimeSessionRef,
			});

			const promptInput: Record<string, unknown> = {
				prompt: input.prompt,
				systemPrompt: input.systemPrompt,
			};
			const stream = agent.prompt(sessionId, promptInput);
			let totalText = "";
			let totalThinking = "";

			for await (const event of stream) {
				switch (event.type) {
					case "text-delta":
						totalText += event.text;
						input.stream.emit({
							type: "text.delta",
							commandId: input.commandId,
							text: event.text,
						});
						break;
					case "thinking-delta":
						totalThinking += event.text;
						input.stream.emit({
							type: "thinking.delta",
							commandId: input.commandId,
							text: event.text,
						});
						break;
					case "tool-call":
						input.stream.emit({
							type: "tool.started",
							commandId: input.commandId,
							tool: event.tool,
							input: event.input,
						});
						break;
					case "tool-call-update":
						input.stream.emit({
							type: "tool.update",
							commandId: input.commandId,
							tool: event.toolCallId,
							status: event.status,
							output: event.output,
						});
						break;
					case "usage":
						input.stream.emit({
							type: "usage",
							commandId: input.commandId,
							inputTokens: event.usage.used,
							outputTokens: event.usage.size - event.usage.used,
							cost: event.usage.cost?.amount ?? undefined,
						});
						break;
					case "finish": {
						const result = {
							text: totalText,
							thinking: totalThinking || undefined,
							sessionRef: sessionId as string,
							inputTokens: event.usage?.used ?? 0,
							outputTokens: (event.usage?.size ?? 0) - (event.usage?.used ?? 0),
							cost: event.usage?.cost?.amount ?? undefined,
							stopReason: event.stopReason ?? "end_turn",
						};
						input.stream.emit({
							type: "command.completed",
							commandId: input.commandId,
							result,
						});
						return result;
					}
				}
			}

			return {
				text: totalText,
				thinking: totalThinking || undefined,
				sessionRef: sessionId as string,
				inputTokens: 0,
				outputTokens: 0,
				stopReason: "end_turn",
			};
		} finally {
			await agent.close();
		}
	} finally {
		input.stream.close();
	}
}

function requireDirectRuntime(runtime: string): DirectSpawnRuntime {
	if (runtime === "claude-code" || runtime === "codex") return runtime;
	throw new Error(`Unsupported spawn-agent runtime "${runtime}"`);
}

function buildIsolatedEnvRecord(
	workerDir: string,
	runtime: DirectSpawnRuntime,
): Record<string, string> {
	if (runtime === "codex") {
		return { CODEX_HOME: join(workerDir, "homes", "codex") };
	}

	return {
		CLAUDE_CONFIG_DIR: join(workerDir, "homes", "claude-code", "config"),
		CLAUDE_DATA_DIR: join(workerDir, "homes", "claude-code", "data"),
	};
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
				headers: isRecord(server.headers) ? { ...server.headers } : undefined,
			};
		}
		return {
			name: server.name,
			command: server.command,
			args: Array.isArray(server.args) ? [...server.args] : undefined,
			env: isRecord(server.env) ? { ...server.env } : undefined,
		};
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
