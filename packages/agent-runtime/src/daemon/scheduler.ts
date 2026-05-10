import type { RuntimeKind } from "../types/runtime.js";
import type { RuntimeCommandMessageSend } from "../types/commands.js";

export interface QueuedCommand {
	readonly commandId: string;
	readonly command: RuntimeCommandMessageSend;
	readonly priority: number;
	readonly enqueuedAt: number;
}

export interface SchedulerConfig {
	readonly concurrency: Partial<Record<RuntimeKind, number>>;
}

export class Scheduler {
	private queue: QueuedCommand[] = [];
	private running = new Map<string, { runtime: RuntimeKind; sessionRef?: string }>();
	private sessionMutexes = new Set<string>();
	private readonly concurrency: Partial<Record<RuntimeKind, number>>;

	constructor(config: SchedulerConfig) {
		this.concurrency = config.concurrency;
	}

	enqueue(item: QueuedCommand): void {
		this.queue.push(item);
		this.queue.sort((a, b) => {
			if (b.priority !== a.priority) return b.priority - a.priority;
			return a.enqueuedAt - b.enqueuedAt;
		});
	}

	dequeue(): QueuedCommand | null {
		for (let i = 0; i < this.queue.length; i++) {
			const item = this.queue[i]!;
			const runtime = item.command.runtime;

			if (!this.hasCapacity(runtime)) continue;

			const sessionKey = item.command.sessionRef
				? `${runtime}:${item.command.sessionRef}`
				: null;
			if (sessionKey && this.sessionMutexes.has(sessionKey)) continue;

			this.queue.splice(i, 1);
			return item;
		}
		return null;
	}

	markRunning(commandId: string, runtime: RuntimeKind, sessionRef?: string): void {
		this.running.set(commandId, { runtime, sessionRef });
		if (sessionRef) {
			this.sessionMutexes.add(`${runtime}:${sessionRef}`);
		}
	}

	markDone(commandId: string): void {
		const info = this.running.get(commandId);
		if (!info) return;
		this.running.delete(commandId);
		if (info.sessionRef) {
			this.sessionMutexes.delete(`${info.runtime}:${info.sessionRef}`);
		}
	}

	cancel(commandId: string): boolean {
		const idx = this.queue.findIndex((q) => q.commandId === commandId);
		if (idx >= 0) {
			this.queue.splice(idx, 1);
			return true;
		}
		return false;
	}

	get activeCount(): number {
		return this.running.size;
	}

	get queuedCount(): number {
		return this.queue.length;
	}

	private hasCapacity(runtime: RuntimeKind): boolean {
		const limit = this.concurrency[runtime] ?? 1;
		let count = 0;
		for (const info of this.running.values()) {
			if (info.runtime === runtime) count++;
		}
		return count < limit;
	}
}
