import { randomUUID } from "node:crypto";
import type {
	Relay,
	RelayConfig,
	RelayCommandInput,
	RelayCommandHandle,
	WorkerIdentity,
	WorkerCapabilities,
} from "../types/relay.js";
import type { RuntimeEvent } from "../types/events.js";
import type { RuntimeKind } from "../types/runtime.js";
import type { CommandResult } from "../types/commands.js";
import { AgentRuntimeError } from "../types/errors.js";

interface ConnectedWorker extends WorkerIdentity {
	lastHeartbeat: number;
}

interface PendingCommand {
	commandId: string;
	input: RelayCommandInput;
	assignmentId: string;
	events: RuntimeEvent[];
	listeners: Set<(event: RuntimeEvent) => void>;
	resolve: (result: CommandResult) => void;
	reject: (error: Error) => void;
	promise: Promise<CommandResult>;
	assignedWorkerId?: string;
}

export function createRelay(config: RelayConfig): Relay {
	const workers = new Map<string, ConnectedWorker>();
	const pendingCommands = new Map<string, PendingCommand>();

	function findWorkerForCommand(
		input: RelayCommandInput,
	): ConnectedWorker | null {
		if (input.targetVolumeId) {
			for (const worker of workers.values()) {
				if (worker.volumeId === input.targetVolumeId) {
					const hasRuntime = worker.capabilities.runtimes.some(
						(r) => r.kind === input.targetRuntimeKind,
					);
					if (hasRuntime) return worker;
				}
			}
			return null;
		}

		for (const worker of workers.values()) {
			const rt = worker.capabilities.runtimes.find(
				(r) => r.kind === input.targetRuntimeKind,
			);
			if (!rt) continue;
			if (
				input.targetModel &&
				rt.models &&
				!rt.models.includes(input.targetModel)
			) {
				continue;
			}
			return worker;
		}
		return null;
	}

	const relay: Relay = {
		async handleRequest(request: Request): Promise<Response> {
			const url = new URL(request.url);
			const path = url.pathname;

			const identity = await config.auth.validateWorker(request);
			if (!identity && !path.endsWith("/submit")) {
				return new Response("Unauthorized", { status: 401 });
			}

			if (request.method === "POST" && path.endsWith("/register")) {
				if (!identity) return new Response("Unauthorized", { status: 401 });
				workers.set(identity.workerId, {
					...identity,
					lastHeartbeat: Date.now(),
				});
				config.onWorkerRegistered?.(identity);
				return Response.json({ ok: true });
			}

			if (request.method === "POST" && path.endsWith("/heartbeat")) {
				if (!identity) return new Response("Unauthorized", { status: 401 });
				const worker = workers.get(identity.workerId);
				if (worker) {
					worker.lastHeartbeat = Date.now();
				}
				return Response.json({ ok: true });
			}

			if (request.method === "POST" && path.endsWith("/poll")) {
				if (!identity) return new Response("Unauthorized", { status: 401 });
				const commands: any[] = [];
				for (const pending of pendingCommands.values()) {
					if (pending.assignedWorkerId) continue;
					const rt =
						identity.capabilities.runtimes.find(
							(r) =>
								r.kind ===
								pending.input.targetRuntimeKind,
						);
					if (!rt) continue;
					if (
						pending.input.targetVolumeId &&
						pending.input.targetVolumeId !== identity.volumeId
					) {
						continue;
					}
					pending.assignedWorkerId = identity.workerId;
					commands.push({
						command_id: pending.commandId,
						assignment_id: pending.assignmentId,
						runtime: pending.input.targetRuntimeKind,
						type: pending.input.command.type,
						priority: pending.input.command.priority ?? 50,
						prompt: pending.input.command.prompt,
						cwd: pending.input.command.cwd,
						session_ref: pending.input.command.sessionRef,
						model_preference: pending.input.command.modelPreference,
						system_prompt: pending.input.command.systemPrompt,
						mcp_servers: pending.input.command.mcpServers,
						meta: pending.input.command.meta,
					});
				}
				return Response.json({ commands });
			}

			if (request.method === "POST" && path.includes("/events")) {
				const commandId = extractCommandId(path, "/events");
				const pending = pendingCommands.get(commandId);
				if (!pending) {
					return new Response("Command not found", { status: 404 });
				}
				const body = (await request.json()) as {
					events: RuntimeEvent[];
				};
				for (const event of body.events) {
					pending.events.push(event);
					for (const listener of pending.listeners) {
						listener(event);
					}
				}
				return Response.json({ ok: true });
			}

			if (request.method === "POST" && path.includes("/complete")) {
				const commandId = extractCommandId(path, "/complete");
				const pending = pendingCommands.get(commandId);
				if (!pending) {
					return new Response("Command not found", { status: 404 });
				}
				const body = (await request.json()) as {
					status: string;
					runtime_session_ref?: string;
					assistant_message?: { text: string };
					usage?: {
						inputTokens: number;
						outputTokens: number;
						cost?: number;
					};
					error?: { code: string; message: string };
				};

				if (body.status === "completed") {
					const result: CommandResult = {
						text: body.assistant_message?.text ?? "",
						sessionRef: body.runtime_session_ref ?? "",
						inputTokens: body.usage?.inputTokens ?? 0,
						outputTokens: body.usage?.outputTokens ?? 0,
						cost: body.usage?.cost,
						stopReason: "end_turn",
					};
					pending.resolve(result);
				} else {
					pending.reject(
						new AgentRuntimeError(
							(body.error?.code as any) ?? "UNKNOWN",
							body.error?.message ?? "Command failed",
						),
					);
				}
				pendingCommands.delete(commandId);
				return Response.json({ ok: true });
			}

			if (
				request.method === "POST" &&
				path.endsWith("/deregister")
			) {
				if (!identity) return new Response("Unauthorized", { status: 401 });
				workers.delete(identity.workerId);
				config.onWorkerOffline?.(identity.workerId);
				return Response.json({ ok: true });
			}

			if (request.method === "POST" && path.includes("/cancel")) {
				const commandId = extractCommandId(path, "/cancel");
				const pending = pendingCommands.get(commandId);
				if (pending) {
					pending.reject(
						new AgentRuntimeError(
							"COMMAND_CANCELLED",
							"Cancelled via relay",
						),
					);
					pendingCommands.delete(commandId);
				}
				return Response.json({ ok: true });
			}

			return new Response("Not found", { status: 404 });
		},

		async submitCommand(
			input: RelayCommandInput,
		): Promise<RelayCommandHandle> {
			const commandId = `cmd_${randomUUID().slice(0, 12)}`;
			const assignmentId = `assign_${randomUUID().slice(0, 8)}`;

			let resolve!: (result: CommandResult) => void;
			let reject!: (error: Error) => void;
			const promise = new Promise<CommandResult>((res, rej) => {
				resolve = res;
				reject = rej;
			});

			const pending: PendingCommand = {
				commandId,
				input,
				assignmentId,
				events: [],
				listeners: new Set(),
				resolve,
				reject,
				promise,
			};
			pendingCommands.set(commandId, pending);

			const events: AsyncIterable<RuntimeEvent> = {
				[Symbol.asyncIterator]() {
					let idx = 0;
					let done = false;
					let waiting:
						| ((
								value: IteratorResult<RuntimeEvent>,
						  ) => void)
						| null = null;

					const listener = (event: RuntimeEvent) => {
						if (waiting) {
							const resolve = waiting;
							waiting = null;
							resolve({ value: event, done: false });
						}
					};
					pending.listeners.add(listener);

					promise
						.then(() => {
							done = true;
							if (waiting) {
								const resolve = waiting;
								waiting = null;
								resolve({
									value: undefined as any,
									done: true,
								});
							}
						})
						.catch(() => {
							done = true;
							if (waiting) {
								const resolve = waiting;
								waiting = null;
								resolve({
									value: undefined as any,
									done: true,
								});
							}
						});

					return {
						next(): Promise<IteratorResult<RuntimeEvent>> {
							if (idx < pending.events.length) {
								return Promise.resolve({
									value: pending.events[idx++]!,
									done: false,
								});
							}
							if (done) {
								pending.listeners.delete(listener);
								return Promise.resolve({
									value: undefined as any,
									done: true,
								});
							}
							return new Promise((resolve) => {
								waiting = resolve;
								idx = pending.events.length;
							});
						},
					};
				},
			};

			return {
				commandId,
				events,
				completion: promise,
				async cancel() {
					const cmd = pendingCommands.get(commandId);
					if (cmd) {
						cmd.reject(
							new AgentRuntimeError(
								"COMMAND_CANCELLED",
								"Cancelled",
							),
						);
						pendingCommands.delete(commandId);
					}
				},
			};
		},

		getConnectedWorkers(): WorkerIdentity[] {
			return [...workers.values()];
		},

		getWorker(workerId: string): WorkerIdentity | null {
			return workers.get(workerId) ?? null;
		},
	};

	return relay;
}

function extractCommandId(path: string, suffix: string): string {
	const parts = path.split("/");
	const suffixIdx = parts.findIndex((p) =>
		p === suffix.replace("/", ""),
	);
	return parts[suffixIdx - 1] ?? "";
}
