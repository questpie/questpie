import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { streamText } from "ai";
import { createSpawnAgentSession } from "spawn-agent";

import type {
	SpawnAgentRunHandle,
	SpawnAgentRunner,
	SpawnAgentRunRequest,
} from "../modules/ai/lib/execution-contract.js";

// One execution surface: the Vercel AI SDK `spawn-agent` provider, which speaks
// the Agent Client Protocol to whatever agent CLI is installed on the host
// (claude / codex / opencode). No hand-rolled ACP client, no env isolation —
// the agent uses the host's own auth (~/.codex, ~/.claude, opencode creds).

export type DirectSpawnRuntime = "claude-code" | "codex" | "opencode";

// Map our runtime ids to spawn-agent agent ids. Type is inferred from the
// provider's own signature — never hand-declared.
type AgentArg = Parameters<typeof createSpawnAgentSession>[0];
type SessionOptions = NonNullable<Parameters<typeof createSpawnAgentSession>[1]>;

const RUNTIME_TO_AGENT: Record<DirectSpawnRuntime, AgentArg> = {
	"claude-code": "claude",
	codex: "codex",
	opencode: "opencode",
};

const DEFAULT_RUN_TIMEOUT_MS = 30 * 60 * 1000;

export interface DirectSpawnRuntimeConfig {
	runtime: DirectSpawnRuntime;
	binaryPath?: string;
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
	return {
		async run(input: SpawnAgentRunRequest): Promise<SpawnAgentRunHandle> {
			const commandId = `cmd_${randomUUID().slice(0, 12)}`;
			const stream = createEventStream();
			const completion = runViaProvider({
				input,
				commandId,
				workerDir: config.workerDir,
				mcpServers: normalizeMcpServers(
					mergeMcpServers(config.mcpServers, input.mcpServers),
				),
				stream,
			});

			return { events: stream.events, completion };
		},
	};
}

async function runViaProvider(args: {
	input: SpawnAgentRunRequest;
	commandId: string;
	workerDir: string;
	mcpServers: unknown[];
	stream: EventStream;
}): Promise<Record<string, unknown>> {
	const { input, commandId, workerDir, mcpServers, stream } = args;
	const runtime = input.runtime as DirectSpawnRuntime;
	const agentId = RUNTIME_TO_AGENT[runtime];
	if (!agentId) {
		stream.close();
		throw new Error(`Unsupported spawn-agent runtime "${input.runtime}"`);
	}

	const cwd = input.cwd ?? workerDir;

	try {
		stream.emit({ type: "command.started", commandId, runtime });

		const session = await createSpawnAgentSession(agentId, {
			cwd,
			mcpServers: mcpServers as SessionOptions["mcpServers"],
			systemPrompt: input.systemPrompt,
			permission: "auto-allow",
		});

		stream.emit({
			type: "session.resolved",
			commandId,
			sessionRef: session.sessionId,
		});

		try {
			const result = streamText({
				model: session.model,
				prompt: input.prompt,
				abortSignal: AbortSignal.timeout(DEFAULT_RUN_TIMEOUT_MS),
			});

			for await (const part of result.fullStream) {
				mapStreamPart(part, commandId, stream);
			}

			const [text, usage, finishReason] = await Promise.all([
				result.text,
				result.usage,
				result.finishReason,
			]);

			const completion = {
				text,
				sessionRef: session.sessionId,
				inputTokens: usage?.inputTokens ?? 0,
				outputTokens: usage?.outputTokens ?? 0,
				stopReason: finishReason ?? "end_turn",
			};

			stream.emit({ type: "command.completed", commandId, result: completion });
			return completion;
		} finally {
			await session.close().catch(() => {});
		}
	} catch (error) {
		stream.emit({
			type: "agent.error",
			commandId,
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	} finally {
		stream.close();
	}
}

function mapStreamPart(
	part: { type: string } & Record<string, unknown>,
	commandId: string,
	stream: EventStream,
) {
	switch (part.type) {
		case "text-delta": {
			const text = (part.text ?? part.delta ?? part.textDelta) as
				| string
				| undefined;
			if (text) stream.emit({ type: "text.delta", commandId, text });
			break;
		}
		case "reasoning-delta": {
			const text = (part.text ?? part.delta) as string | undefined;
			if (text) stream.emit({ type: "thinking.delta", commandId, text });
			break;
		}
		case "tool-call":
			stream.emit({
				type: "tool.started",
				commandId,
				tool: part.toolName,
				toolCallId: part.toolCallId,
				input: part.input ?? part.args,
			});
			break;
		case "tool-result":
			stream.emit({
				type: "tool.update",
				commandId,
				tool: part.toolCallId,
				output: part.output ?? part.result,
			});
			break;
		case "error":
			stream.emit({
				type: "agent.stderr",
				commandId,
				text: String((part as { error?: unknown }).error ?? ""),
			});
			break;
	}
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
							return Promise.resolve({ value: undefined as never, done: true });
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
