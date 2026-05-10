import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
	Daemon,
	DaemonConfig,
	DaemonStatus,
} from "../types/daemon.js";
import type { RuntimeKind } from "../types/runtime.js";
import type {
	RuntimeCommand,
	CommandHandle,
	CommandResult,
} from "../types/commands.js";
import type { RuntimeEvent } from "../types/events.js";
import type { SessionEntry, SessionSnapshot } from "../types/sessions.js";
import type { RuntimeProfile } from "../types/profiles.js";
import type { RuntimeAdapter } from "../types/adapter.js";
import { AgentRuntimeError } from "../types/errors.js";
import { VolumeLock } from "./volume-lock.js";
import { Scheduler, type QueuedCommand } from "./scheduler.js";

interface RunningCommand {
	commandId: string;
	abort: AbortController;
}

export function createDaemon(
	config: DaemonConfig,
	adapters: RuntimeAdapter[],
): Daemon {
	const lock = new VolumeLock(
		config.workerDir,
		config.staleLockTimeoutMs ?? 60_000,
	);
	const scheduler = new Scheduler({
		concurrency: config.concurrency ?? {},
	});

	let volumeId = "";
	let running = false;
	let startedAt = 0;
	const runningCommands = new Map<string, RunningCommand>();
	const profiles = new Map<string, RuntimeProfile>();
	const adapterMap = new Map<RuntimeKind, RuntimeAdapter>();
	let drainTimer: ReturnType<typeof setInterval> | null = null;

	const detectedRuntimes: DaemonStatus["runtimes"][number][] = [];

	for (const adapter of adapters) {
		adapterMap.set(adapter.kind, adapter);
	}

	function getAdapter(runtime: RuntimeKind): RuntimeAdapter {
		const adapter = adapterMap.get(runtime);
		if (!adapter) {
			throw new AgentRuntimeError(
				"ADAPTER_NOT_FOUND",
				`No adapter registered for runtime "${runtime}"`,
				{ runtime },
			);
		}
		return adapter;
	}

	function drainQueue(): void {
		let next: QueuedCommand | null;
		while ((next = scheduler.dequeue())) {
			executeCommand(next);
		}
	}

	function resolveSessionPath(runtime: RuntimeKind, sessionRef: string): string {
		return join(config.workerDir, "homes", runtime, "sessions", sessionRef);
	}

	function storageKey(runtime: RuntimeKind, sessionRef: string): string {
		return `${runtime}/${sessionRef}`;
	}

	async function pullSession(runtime: RuntimeKind, sessionRef: string): Promise<void> {
		if (!config.sessionStorage) return;
		const key = storageKey(runtime, sessionRef);
		try {
			const exists = await config.sessionStorage.exists(key);
			if (exists) {
				const localPath = resolveSessionPath(runtime, sessionRef);
				await mkdir(join(localPath, ".."), { recursive: true });
				await config.sessionStorage.pull(key, localPath);
			}
		} catch {}
	}

	async function pushSession(runtime: RuntimeKind, sessionRef: string): Promise<void> {
		if (!config.sessionStorage) return;
		const key = storageKey(runtime, sessionRef);
		const localPath = resolveSessionPath(runtime, sessionRef);
		try {
			await config.sessionStorage.push(localPath, key);
		} catch {}
	}

	function executeCommand(queued: QueuedCommand): void {
		const { commandId, command } = queued;
		const adapter = getAdapter(command.runtime);
		const abort = new AbortController();

		runningCommands.set(commandId, { commandId, abort });
		scheduler.markRunning(commandId, command.runtime, command.sessionRef);

		const profileRef = command.profile;
		let profile: RuntimeProfile | undefined;
		if (profileRef) {
			const id = typeof profileRef === "string" ? profileRef : profileRef.id;
			profile = profiles.get(id);
		}

		const runtimeConfig = config.runtimes.find(
			(r) => r.runtime === command.runtime,
		) ?? { runtime: command.runtime };

		const doExecute = async () => {
			if (command.sessionRef) {
				await pullSession(command.runtime, command.sessionRef);
			}

			return adapter.sendMessage({
				workerDir: config.workerDir,
				config: runtimeConfig,
				commandId,
				prompt: command.prompt,
				cwd: command.cwd,
				sessionRef: command.sessionRef,
				profile,
				modelPreference: command.modelPreference,
				systemPrompt: command.systemPrompt,
				mcpServers: command.mcpServers,
				signal: abort.signal,
			});
		};

		void doExecute().then(
			(eventIterator) => consumeEvents(commandId, command, eventIterator),
			(err) => {
				const stream = commandStreams.get(commandId);
				stream?.reject(
					err instanceof AgentRuntimeError
						? err
						: new AgentRuntimeError("UNKNOWN", String(err), { cause: err }),
				);
				scheduler.markDone(commandId);
				runningCommands.delete(commandId);
				drainQueue();
			},
		);
	}

	const commandStreams = new Map<
		string,
		{
			events: RuntimeEvent[];
			listeners: Set<(event: RuntimeEvent) => void>;
			resolve: (result: CommandResult) => void;
			reject: (error: Error) => void;
			promise: Promise<CommandResult>;
		}
	>();

	async function consumeEvents(
		commandId: string,
		command: RuntimeCommand & { type: "message.send" },
		iterable: AsyncIterable<RuntimeEvent>,
	): Promise<void> {
		const stream = commandStreams.get(commandId);
		let resolvedSessionRef: string | undefined;
		try {
			for await (const event of iterable) {
				if (stream) {
					stream.events.push(event);
					for (const listener of stream.listeners) {
						listener(event);
					}
				}

				if (event.type === "session.resolved") {
					resolvedSessionRef = event.sessionRef;
				} else if (event.type === "command.completed") {
					resolvedSessionRef ??= event.result.sessionRef;
					if (resolvedSessionRef) {
						await pushSession(command.runtime, resolvedSessionRef);
					}
					stream?.resolve(event.result);
				} else if (event.type === "command.failed") {
					stream?.reject(event.error);
				}
			}
		} catch (err) {
			const error =
				err instanceof AgentRuntimeError
					? err
					: new AgentRuntimeError("UNKNOWN", String(err), {
							cause: err,
						});
			stream?.reject(error);
		} finally {
			scheduler.markDone(commandId);
			runningCommands.delete(commandId);
			drainQueue();
		}
	}

	const daemon: Daemon = {
		get volumeId() {
			return volumeId;
		},

		get isRunning() {
			return running;
		},

		async start() {
			await mkdir(join(config.workerDir, "homes"), { recursive: true });
			await mkdir(join(config.workerDir, "profiles"), {
				recursive: true,
			});
			await mkdir(join(config.workerDir, "tmp"), { recursive: true });

			volumeId = await lock.acquire(
				config.heartbeatIntervalMs ?? 30_000,
			);
			running = true;
			startedAt = Date.now();

			for (const rtConfig of config.runtimes) {
				const adapter = adapterMap.get(rtConfig.runtime);
				if (!adapter) continue;
				const result = await adapter.detect({
					workerDir: config.workerDir,
					config: rtConfig,
				});
				detectedRuntimes.push({
					kind: rtConfig.runtime,
					detected: result.available,
					version: result.version,
				});
			}

			drainTimer = setInterval(() => drainQueue(), 1_000);
		},

		async stop() {
			running = false;
			if (drainTimer) {
				clearInterval(drainTimer);
				drainTimer = null;
			}

			for (const cmd of runningCommands.values()) {
				cmd.abort.abort();
			}

			await lock.release();
		},

		async submit(command: RuntimeCommand): Promise<CommandHandle> {
			if (command.type !== "message.send") {
				if (command.type === "session.list") {
					throw new AgentRuntimeError(
						"UNKNOWN",
						"Use daemon.listSessions() for session.list commands",
					);
				}
				if (command.type === "session.get") {
					throw new AgentRuntimeError(
						"UNKNOWN",
						"Use daemon.getSession() for session.get commands",
					);
				}
				throw new AgentRuntimeError("UNKNOWN", "Unknown command type");
			}

			const commandId = `cmd_${randomUUID().slice(0, 12)}`;

			let resolve!: (result: CommandResult) => void;
			let reject!: (error: Error) => void;
			const promise = new Promise<CommandResult>((res, rej) => {
				resolve = res;
				reject = rej;
			});

			const streamState = {
				events: [] as RuntimeEvent[],
				listeners: new Set<(event: RuntimeEvent) => void>(),
				resolve,
				reject,
				promise,
			};
			commandStreams.set(commandId, streamState);

			const queued: QueuedCommand = {
				commandId,
				command,
				priority: command.priority ?? 50,
				enqueuedAt: Date.now(),
			};

			scheduler.enqueue(queued);
			drainQueue();

			const events: AsyncIterable<RuntimeEvent> = {
				[Symbol.asyncIterator]() {
					let idx = 0;
					let done = false;
					let waiting: ((value: IteratorResult<RuntimeEvent>) => void) | null = null;

					const listener = (_event: RuntimeEvent) => {
						if (waiting) {
							const resolve = waiting;
							waiting = null;
							idx = streamState.events.length;
							resolve({ value: streamState.events[idx - 1]!, done: false });
						}
					};
					streamState.listeners.add(listener);

					promise
						.then(() => {
							done = true;
							if (waiting) {
								const resolve = waiting;
								waiting = null;
								resolve({ value: undefined as any, done: true });
							}
						})
						.catch(() => {
							done = true;
							if (waiting) {
								const resolve = waiting;
								waiting = null;
								resolve({ value: undefined as any, done: true });
							}
						});

					return {
						next(): Promise<IteratorResult<RuntimeEvent>> {
							if (idx < streamState.events.length) {
								return Promise.resolve({
									value: streamState.events[idx++]!,
									done: false,
								});
							}
							if (done) {
								streamState.listeners.delete(listener);
								return Promise.resolve({
									value: undefined as any,
									done: true,
								});
							}
							return new Promise((resolve) => {
								waiting = resolve;
								idx = streamState.events.length;
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
					const removed = scheduler.cancel(commandId);
					if (removed) {
						streamState.reject(
							new AgentRuntimeError(
								"COMMAND_CANCELLED",
								"Command cancelled before execution",
							),
						);
						commandStreams.delete(commandId);
						return;
					}
					const cmd = runningCommands.get(commandId);
					if (cmd) {
						cmd.abort.abort();
					}
				},
			};
		},

		getStatus(): DaemonStatus {
			return {
				volumeId,
				runtimes: detectedRuntimes,
				activeCommands: scheduler.activeCount,
				queuedCommands: scheduler.queuedCount,
				uptime: running ? Date.now() - startedAt : 0,
			};
		},

		async listSessions(runtime?: RuntimeKind): Promise<SessionEntry[]> {
			const results: SessionEntry[] = [];
			const targets = runtime
				? [getAdapter(runtime)]
				: [...adapterMap.values()];

			for (const adapter of targets) {
				const rtConfig = config.runtimes.find(
					(r) => r.runtime === adapter.kind,
				) ?? { runtime: adapter.kind };
				const entries = await adapter.listSessions({
					workerDir: config.workerDir,
					config: rtConfig,
				});
				results.push(...entries);
			}
			return results;
		},

		async getSession(
			runtime: RuntimeKind,
			sessionRef: string,
		): Promise<SessionSnapshot> {
			const adapter = getAdapter(runtime);
			const rtConfig = config.runtimes.find(
				(r) => r.runtime === runtime,
			) ?? { runtime };
			return adapter.getSession({
				workerDir: config.workerDir,
				config: rtConfig,
				sessionRef,
			});
		},

		async setProfile(profile: RuntimeProfile): Promise<void> {
			profiles.set(profile.id, profile);
		},

		async removeProfile(profileId: string): Promise<void> {
			profiles.delete(profileId);
		},

		listProfiles(): RuntimeProfile[] {
			return [...profiles.values()];
		},
	};

	return daemon;
}
