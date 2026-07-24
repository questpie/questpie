import { CrdtEngineError, type CrdtFieldEngine } from "questpie/crdt";

import { createYjsTextEngineCore } from "./text-engine.js";
import type {
	YjsWorkerOperation,
	YjsWorkerResponse,
} from "./worker-protocol.js";

const MAXIMUM_PENDING_JOBS = 64;
const HOST_ACTIVE_WORKER_CAP = Math.min(
	4,
	2 *
		Math.max(
			1,
			typeof navigator === "undefined" ? 1 : navigator.hardwareConcurrency,
		),
);

export type YjsTextEngineOptions = Readonly<{
	operationTimeoutMs?: number;
	maximumActiveWorkers?: number;
	maximumPendingJobs?: number;
}>;

export function createYjsTextEngine(
	options: YjsTextEngineOptions = {},
): CrdtFieldEngine<"text", string> {
	const core = createYjsTextEngineCore();
	const timeout = options.operationTimeoutMs ?? 100;
	if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000) {
		throw new CrdtEngineError("invalid Yjs worker timeout");
	}
	const activeWorkers = options.maximumActiveWorkers ?? HOST_ACTIVE_WORKER_CAP;
	const pendingJobs = options.maximumPendingJobs ?? MAXIMUM_PENDING_JOBS;
	if (
		!Number.isSafeInteger(activeWorkers) ||
		activeWorkers < 1 ||
		activeWorkers > HOST_ACTIVE_WORKER_CAP
	) {
		throw new CrdtEngineError("invalid Yjs active worker limit");
	}
	if (
		!Number.isSafeInteger(pendingJobs) ||
		pendingJobs < 0 ||
		pendingJobs > MAXIMUM_PENDING_JOBS
	) {
		throw new CrdtEngineError("invalid Yjs pending job limit");
	}
	const pool = new YjsStageWorkerPool(timeout, activeWorkers, pendingJobs);
	return Object.freeze({
		...core,
		stage: (input: Parameters<typeof core.stage>[0]) =>
			pool.execute<Awaited<ReturnType<typeof core.stage>>>(input),
	});
}

type StageInput = Parameters<
	ReturnType<typeof createYjsTextEngineCore>["stage"]
>[0];

type PendingJob = {
	id: number;
	input: StageInput;
	resolve: (value: unknown) => void;
	reject: (error: unknown) => void;
};

type WorkerSlot = {
	worker: Worker;
	ready: boolean;
	job?: PendingJob;
	timer?: ReturnType<typeof setTimeout>;
	startupTimer?: ReturnType<typeof setTimeout>;
};

class YjsStageWorkerPool {
	private readonly pending: PendingJob[] = [];
	private readonly slots = new Set<WorkerSlot>();
	private nextId = 1;

	constructor(
		private readonly timeoutMs: number,
		private readonly maximumActiveWorkers: number,
		private readonly maximumPendingJobs: number,
	) {}

	execute<T>(input: StageInput): Promise<T> {
		const idle = [...this.slots].find((slot) => slot.ready && !slot.job);
		if (!idle && this.pending.length >= this.maximumPendingJobs) {
			return Promise.reject(new CrdtEngineError("Yjs worker queue is full"));
		}
		return new Promise<T>((resolve, reject) => {
			this.pending.push({
				id: this.nextId++,
				input,
				resolve: resolve as (value: unknown) => void,
				reject,
			});
			this.pump();
		});
	}

	private pump(): void {
		for (const slot of this.slots) {
			if (!slot.ready || slot.job || this.pending.length === 0) continue;
			this.start(slot, this.pending.shift()!);
		}
		while (
			this.pending.length > 0 &&
			this.slots.size < this.maximumActiveWorkers
		) {
			this.createSlot();
		}
	}

	private createSlot(): void {
		const workerEntry = import.meta.url.endsWith(".ts")
			? "./worker-entry.ts"
			: "./worker-entry.mjs";
		const worker = new Worker(new URL(workerEntry, import.meta.url), {
			type: "module",
		});
		(
			worker as Worker & {
				unref?: () => void;
			}
		).unref?.();
		const slot: WorkerSlot = { worker, ready: false };
		this.slots.add(slot);
		this.start(slot, this.pending.shift()!);
		slot.startupTimer = setTimeout(() => {
			this.destroySlot(
				slot,
				new CrdtEngineError("Yjs worker startup timed out"),
			);
		}, 2_000);
		worker.addEventListener(
			"message",
			(event: MessageEvent<YjsWorkerResponse>) =>
				this.handleMessage(slot, event.data),
		);
		worker.addEventListener("error", () =>
			this.destroySlot(
				slot,
				new CrdtEngineError("Yjs worker operation failed"),
			),
		);
	}

	private handleMessage(slot: WorkerSlot, response: YjsWorkerResponse): void {
		if (response.type === "ready") {
			if (slot.startupTimer) clearTimeout(slot.startupTimer);
			slot.startupTimer = undefined;
			slot.ready = true;
			if (slot.job) this.send(slot);
			else this.pump();
			return;
		}
		const job = slot.job;
		if (!job || response.id !== job.id) {
			this.destroySlot(
				slot,
				new CrdtEngineError("Yjs worker response correlation failed"),
			);
			return;
		}
		if (slot.timer) clearTimeout(slot.timer);
		slot.timer = undefined;
		slot.job = undefined;
		if (response.ok) job.resolve(response.value);
		else job.reject(new CrdtEngineError(response.message));
		this.pump();
	}

	private start(slot: WorkerSlot, job: PendingJob): void {
		slot.job = job;
		if (slot.ready) this.send(slot);
	}

	private send(slot: WorkerSlot): void {
		const job = slot.job;
		if (!job) return;
		slot.timer = setTimeout(() => {
			this.destroySlot(
				slot,
				new CrdtEngineError("Yjs worker operation timed out"),
			);
		}, this.timeoutMs);
		/* oxlint-disable unicorn/require-post-message-target-origin -- Worker.postMessage has no target origin. */
		slot.worker.postMessage({
			id: job.id,
			method: "stage",
			input: job.input,
		} satisfies YjsWorkerOperation);
		/* oxlint-enable unicorn/require-post-message-target-origin */
	}

	private destroySlot(slot: WorkerSlot, error: Error): void {
		if (!this.slots.delete(slot)) return;
		if (slot.timer) clearTimeout(slot.timer);
		if (slot.startupTimer) clearTimeout(slot.startupTimer);
		slot.job?.reject(error);
		slot.job = undefined;
		void slot.worker.terminate();
		this.pump();
	}
}
