import { join } from "node:path";
import type {
	RuntimeAdapter,
	RuntimeDetectionInput,
	RuntimeDetectionResult,
	RuntimeAdapterContext,
	RuntimeStorageInfo,
	RuntimeListSessionsInput,
	RuntimeGetSessionInput,
	RuntimeSendMessageInput,
	RuntimeCancelInput,
} from "../../types/adapter.js";
import type { RuntimeEvent } from "../../types/events.js";
import type { SessionEntry, SessionSnapshot } from "../../types/sessions.js";
import { AgentRuntimeError } from "../../types/errors.js";

export function createClaudeCodeAdapter(): RuntimeAdapter {
	const runningAgents = new Map<string, { cancel(): Promise<void> }>();

	return {
		kind: "claude-code",

		async detect(input: RuntimeDetectionInput): Promise<RuntimeDetectionResult> {
			const binPath = input.config.binaryPath ?? "claude";
			try {
				const proc = Bun.spawn([binPath, "--version"], {
					stdout: "pipe",
					stderr: "pipe",
					env: buildEnv(input.workerDir),
				});
				const text = await new Response(proc.stdout).text();
				await proc.exited;
				const version = text.trim().split("\n")[0]?.trim();
				return {
					available: proc.exitCode === 0,
					version,
					binaryPath: binPath,
					supportsSessions: true,
					supportsMcp: true,
					supportsSkills: true,
				};
			} catch {
				return {
					available: false,
					supportsSessions: false,
					supportsMcp: false,
					supportsSkills: false,
				};
			}
		},

		async getStorageInfo(
			input: RuntimeAdapterContext,
		): Promise<RuntimeStorageInfo> {
			const homePath = join(input.workerDir, "homes", "claude-code");
			return {
				homePath,
				configPath: join(homePath, "config"),
				sessionPath: join(homePath, "data"),
			};
		},

		async listSessions(
			input: RuntimeListSessionsInput,
		): Promise<SessionEntry[]> {
			try {
				const { SpawnAgent } = await import("spawn-agent");
				const { claude } = await import("spawn-agent/adapters");
				const binPath = input.config.binaryPath ?? "claude";

				const adapter = claude({ binPath });
				const agent = await SpawnAgent.connect(adapter, {
					env: buildIsolatedEnvRecord(input.workerDir),
					cwd: input.cwd,
				});

				try {
					const result: SessionEntry[] = [];
					for await (const session of agent.streamAllSessions({
						cwd: input.cwd,
					})) {
						result.push({
							runtime: "claude-code",
							sessionRef: session.sessionId as string,
							title: session.title ?? undefined,
							cwd: session.cwd ?? undefined,
							updatedAt: session.updatedAt
								? new Date(session.updatedAt)
								: undefined,
						});
					}
					return result;
				} finally {
					await agent.close();
				}
			} catch (err) {
				if (
					err instanceof AgentRuntimeError &&
					err.code === "RUNTIME_NOT_INSTALLED"
				) {
					throw err;
				}
				return [];
			}
		},

		async getSession(
			input: RuntimeGetSessionInput,
		): Promise<SessionSnapshot> {
			const { SpawnAgent } = await import("spawn-agent");
			const { claude } = await import("spawn-agent/adapters");
			const binPath = input.config.binaryPath ?? "claude";

			const adapter = claude({ binPath });
			const agent = await SpawnAgent.connect(adapter, {
				env: buildIsolatedEnvRecord(input.workerDir),
			});

			try {
				const sessions = await agent.listSessions();
				const match = sessions.sessions?.find(
					(s) => (s.sessionId as string) === input.sessionRef,
				);
				if (!match) {
					throw new AgentRuntimeError(
						"SESSION_NOT_FOUND_ON_VOLUME",
						`Session ${input.sessionRef} not found`,
						{ runtime: "claude-code" },
					);
				}
				return {
					runtime: "claude-code",
					sessionRef: input.sessionRef,
					title: match.title ?? undefined,
					cwd: match.cwd ?? undefined,
					updatedAt: match.updatedAt
						? new Date(match.updatedAt)
						: undefined,
				};
			} finally {
				await agent.close();
			}
		},

		async *sendMessage(
			input: RuntimeSendMessageInput,
		): AsyncIterable<RuntimeEvent> {
			const { SpawnAgent, autoAllow } = await import("spawn-agent");
			const { claude } = await import("spawn-agent/adapters");
			const binPath = input.config.binaryPath ?? "claude";

			const adapter = claude({ binPath });

			const mcpServers = (input.mcpServers ?? []).map((s): any => {
				if (s.url) {
					return { type: "http", name: s.name, url: s.url, headers: s.headers ? { ...s.headers } : undefined };
				}
				return { name: s.name, command: s.command!, args: [...(s.args ?? [])], env: s.env ? { ...s.env } : undefined };
			});

			const agent = await SpawnAgent.connect(adapter, {
				env: buildIsolatedEnvRecord(input.workerDir),
				cwd: input.cwd,
				permission: autoAllow,
				mcpServers,
				systemPrompt: input.systemPrompt,
			});

			runningAgents.set(input.commandId, {
				cancel: () => agent.close(),
			});

			try {
				yield {
					type: "command.started",
					commandId: input.commandId,
					runtime: "claude-code",
				};

				let sessionId: any;

				if (input.sessionRef) {
					sessionId = await agent.resumeSession({
						sessionId: input.sessionRef as any,
						cwd: input.cwd,
						mcpServers,
					});
				} else {
					sessionId = await agent.createSession({
						cwd: input.cwd,
						mcpServers,
						systemPrompt: input.systemPrompt,
					});
				}

				yield {
					type: "session.resolved",
					commandId: input.commandId,
					sessionRef: sessionId as string,
					isNew: !input.sessionRef,
				};

				const stream = agent.prompt(sessionId, {
					prompt: input.prompt,
					systemPrompt: input.systemPrompt,
					modelPreference: input.modelPreference
						? {
								configId: "model",
								value: input.modelPreference,
							}
						: undefined,
				});

				let totalText = "";
				let totalThinking = "";

				for await (const event of stream) {
					if (input.signal?.aborted) {
						await stream.cancel();
						yield {
							type: "command.cancelled",
							commandId: input.commandId,
						};
						return;
					}

					switch (event.type) {
						case "text-delta":
							totalText += event.text;
							yield {
								type: "text.delta",
								commandId: input.commandId,
								text: event.text,
							};
							break;
						case "thinking-delta":
							totalThinking += event.text;
							yield {
								type: "thinking.delta",
								commandId: input.commandId,
								text: event.text,
							};
							break;
						case "tool-call":
							yield {
								type: "tool.started",
								commandId: input.commandId,
								tool: event.tool,
								input: event.input,
							};
							break;
						case "tool-call-update":
							yield {
								type: "tool.update",
								commandId: input.commandId,
								tool: event.toolCallId,
								status: event.status,
								output: event.output,
							};
							break;
						case "usage":
							yield {
								type: "usage",
								commandId: input.commandId,
								inputTokens: event.usage.used,
								outputTokens: event.usage.size - event.usage.used,
								cost: event.usage.cost?.amount ?? undefined,
							};
							break;
						case "finish": {
							const usage = event.usage;
							yield {
								type: "command.completed",
								commandId: input.commandId,
								result: {
									text: totalText,
									thinking: totalThinking || undefined,
									sessionRef: sessionId as string,
									inputTokens: usage?.used ?? 0,
									outputTokens:
										(usage?.size ?? 0) - (usage?.used ?? 0),
									cost: usage?.cost?.amount ?? undefined,
									stopReason: event.stopReason ?? "end_turn",
								},
							};
							break;
						}
					}
				}
			} catch (err) {
				const error =
					err instanceof AgentRuntimeError
						? err
						: new AgentRuntimeError(
								"RUNTIME_EXITED_NON_ZERO",
								String(err),
								{ runtime: "claude-code", cause: err },
							);
				yield {
					type: "command.failed",
					commandId: input.commandId,
					error,
				};
			} finally {
				runningAgents.delete(input.commandId);
				await agent.close();
			}
		},

		async cancel(input: RuntimeCancelInput): Promise<void> {
			const running = runningAgents.get(input.commandId);
			if (running) {
				await running.cancel();
				runningAgents.delete(input.commandId);
			}
		},
	};
}

function buildEnv(workerDir: string): Record<string, string> {
	return {
		...process.env as Record<string, string>,
		CLAUDE_CONFIG_DIR: join(workerDir, "homes", "claude-code", "config"),
		CLAUDE_DATA_DIR: join(workerDir, "homes", "claude-code", "data"),
	};
}

function buildIsolatedEnvRecord(
	workerDir: string,
): Record<string, string> {
	return {
		CLAUDE_CONFIG_DIR: join(workerDir, "homes", "claude-code", "config"),
		CLAUDE_DATA_DIR: join(workerDir, "homes", "claude-code", "data"),
	};
}
