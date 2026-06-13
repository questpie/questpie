import { randomUUID } from "node:crypto";

import type { HarnessV1StreamPart } from "@ai-sdk/harness";
import { HarnessAgent } from "@ai-sdk/harness/agent";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";

import type {
	AgentRuntimeRunHandle,
	AgentRuntimeRunner,
	AgentRuntimeRunRequest,
} from "../modules/ai/lib/execution-contract.js";
import { createLocalHostSandbox } from "./local-host-sandbox.js";

export type HarnessRuntime = "claude-code";

export interface HarnessRuntimeConfig {
	runtime: HarnessRuntime;
	binaryPath?: string;
}

export interface HarnessAgentRunnerConfig {
	workerDir: string;
	runtimes: HarnessRuntimeConfig[];
	mcpServers?: unknown[];
}

interface EventStream {
	events: AsyncIterable<Record<string, unknown>>;
	emit(event: Record<string, unknown>): void;
	close(): void;
}

const DEFAULT_RUN_TIMEOUT_MS = 30 * 60 * 1000;

export function createHarnessAgentRunner(
	config: HarnessAgentRunnerConfig,
): AgentRuntimeRunner {
	return {
		async run(input: AgentRuntimeRunRequest): Promise<AgentRuntimeRunHandle> {
			const commandId = `cmd_${randomUUID().slice(0, 12)}`;
			const stream = createEventStream();
			const completion = runViaHarness({ input, commandId, config, stream });

			return { events: stream.events, completion };
		},
	};
}

async function runViaHarness(args: {
	input: AgentRuntimeRunRequest;
	commandId: string;
	config: HarnessAgentRunnerConfig;
	stream: EventStream;
}): Promise<Record<string, unknown>> {
	const { input, commandId, config, stream } = args;
	if (input.runtime !== "claude-code") {
		stream.close();
		throw new Error(`Unsupported harness runtime "${input.runtime}"`);
	}

	const cwd = input.cwd ?? config.workerDir;
	const abortSignal = AbortSignal.timeout(DEFAULT_RUN_TIMEOUT_MS);
	const agent = new HarnessAgent({
		harness: createClaudeCode(),
		sandbox: createLocalHostSandbox({ workRoot: cwd }),
		permissionMode: "allow-all",
	});
	let session: Awaited<ReturnType<typeof agent.createSession>> | undefined;
	let text = "";
	let inputTokens = 0;
	let outputTokens = 0;
	let stopReason = "end_turn";

	try {
		stream.emit({ type: "command.started", commandId, runtime: input.runtime });

		session = await agent.createSession({
			sessionId: input.runtimeSessionRef,
			abortSignal,
		});
		stream.emit({
			type: "session.resolved",
			commandId,
			sessionRef: session.sessionId,
			isNew: !input.runtimeSessionRef,
		});

		const result = await agent.stream({
			prompt: promptWithSystemPrompt(input),
			session,
			abortSignal,
		});

		for await (const part of result.fullStream as AsyncIterable<HarnessV1StreamPart>) {
			const mapped = mapStreamPart(part, commandId);
			if (part.type === "text-delta") text += part.delta;
			if (part.type === "finish") {
				inputTokens = part.totalUsage.inputTokens.total ?? 0;
				outputTokens = part.totalUsage.outputTokens.total ?? 0;
				stopReason = String(part.finishReason ?? stopReason);
			}
			for (const event of mapped) stream.emit(event);
		}

		const completion = {
			text,
			sessionRef: session.sessionId,
			inputTokens,
			outputTokens,
			stopReason,
		};
		stream.emit({ type: "command.completed", commandId, result: completion });
		return completion;
	} catch (error) {
		stream.emit({
			type: "agent.error",
			commandId,
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	} finally {
		await session?.stop().catch(() => {});
		stream.close();
	}
}

function mapStreamPart(
	part: HarnessV1StreamPart,
	commandId: string,
): Record<string, unknown>[] {
	switch (part.type) {
		case "text-delta":
			return [{ type: "text.delta", commandId, text: part.delta }];
		case "reasoning-delta":
			return [{ type: "thinking.delta", commandId, text: part.delta }];
		case "tool-call":
			return [
				{
					type: "tool.started",
					commandId,
					tool: part.toolName,
					toolCallId: part.toolCallId,
					input: part.input,
				},
			];
		case "tool-result":
			return [
				{
					type: "tool.update",
					commandId,
					tool: part.toolName,
					toolCallId: part.toolCallId,
					output: part.result,
				},
			];
		case "error":
			return [
				{
					type: "agent.error",
					commandId,
					error: formatError(part.error),
				},
			];
		default:
			return [];
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

function formatError(error: unknown) {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

function promptWithSystemPrompt(input: AgentRuntimeRunRequest) {
	if (!input.systemPrompt) return input.prompt;
	return `${input.systemPrompt}

${input.prompt}`;
}
