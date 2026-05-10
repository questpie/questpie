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

export function createCodexAdapter(): RuntimeAdapter {
	const runningAgents = new Map<string, { cancel(): Promise<void> }>();

	return {
		kind: "codex",

		async detect(input: RuntimeDetectionInput): Promise<RuntimeDetectionResult> {
			const binPath = input.config.binaryPath ?? "codex";
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
					supportsSkills: false,
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
			const homePath = join(input.workerDir, "homes", "codex");
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
				const { codex } = await import("spawn-agent/adapters");
				const binPath = input.config.binaryPath ?? "codex";

				const adapter = codex({ binPath });
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
							runtime: "codex",
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
			} catch {
				return [];
			}
		},

		async getSession(
			input: RuntimeGetSessionInput,
		): Promise<SessionSnapshot> {
			const { SpawnAgent } = await import("spawn-agent");
			const { codex } = await import("spawn-agent/adapters");
			const binPath = input.config.binaryPath ?? "codex";

			const adapter = codex({ binPath });
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
						{ runtime: "codex" },
					);
				}
				return {
					runtime: "codex",
					sessionRef: input.sessionRef,
					title: match.title ?? undefined,
					cwd: match.cwd ?? undefined,
				};
			} finally {
				await agent.close();
			}
		},

		async *sendMessage(
			input: RuntimeSendMessageInput,
		): AsyncIterable<RuntimeEvent> {
			const { SpawnAgent, autoAllow } = await import("spawn-agent");
			const { codex } = await import("spawn-agent/adapters");
			const binPath = input.config.binaryPath ?? "codex";

			const adapter = codex({ binPath });
			const mcpServers = (input.mcpServers ?? []).map((s): any => {
				if (s.url) {
					return { type: "http", name: s.name, url: s.url };
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
					runtime: "codex",
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
				});

				let totalText = "";

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
						case "finish":
							yield {
								type: "command.completed",
								commandId: input.commandId,
								result: {
									text: totalText,
									sessionRef: sessionId as string,
									inputTokens: event.usage?.used ?? 0,
									outputTokens:
										(event.usage?.size ?? 0) -
										(event.usage?.used ?? 0),
									cost: event.usage?.cost?.amount ?? undefined,
									stopReason: event.stopReason ?? "end_turn",
								},
							};
							break;
					}
				}
			} catch (err) {
				const error =
					err instanceof AgentRuntimeError
						? err
						: new AgentRuntimeError(
								"RUNTIME_EXITED_NON_ZERO",
								String(err),
								{ runtime: "codex", cause: err },
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
		...(process.env as Record<string, string>),
		CODEX_HOME: join(workerDir, "homes", "codex"),
	};
}

function buildIsolatedEnvRecord(
	workerDir: string,
): Record<string, string> {
	return {
		CODEX_HOME: join(workerDir, "homes", "codex"),
	};
}
