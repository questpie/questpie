import type {
	RealtimeDesiredSubscription,
	RealtimeDesiredTopology,
	RealtimeTopologyApplyInput,
} from "./topology-coordinator.js";
import type {
	ClientCloseReason,
	ClientSink,
	DeliveryClass,
	SinkWriteResult,
} from "./transport.js";

export type RealtimeEdgeBinding = {
	/**
	 * Publish a fully staged binding. This must be a synchronous, non-throwing
	 * state transition; asynchronous output flushing belongs behind the binding.
	 */
	activate(): void;
	/** Fail the candidate before publication if asynchronous staging broke. */
	assertReady?(): void;
	/** Stop the binding and discard output that was never activated. */
	close(): void | Promise<void>;
};

export type RealtimeEdgeBindingEntry = {
	subscription: RealtimeDesiredSubscription;
	binding: RealtimeEdgeBinding;
};

export type RealtimeEdgeBindingFactory = (
	subscription: RealtimeDesiredSubscription,
	input: Pick<RealtimeTopologyApplyInput, "ownerGeneration" | "signal">,
) => Promise<RealtimeEdgeBinding>;

export class RealtimeEdgeBindingStageError extends Error {
	constructor(
		readonly subscription: RealtimeDesiredSubscription,
		readonly cause: unknown,
	) {
		super(
			`Failed to stage realtime ${subscription.kind} binding ${subscription.id}: ${
				cause instanceof Error ? cause.message : "unknown error"
			}`,
		);
		this.name = "RealtimeEdgeBindingStageError";
	}
}

export type RealtimeBindingOutputGateOptions = {
	maximumOrderedEvents: number;
	maximumBufferedBytes: number;
	onError(error: unknown): void;
};

type PendingOutput = {
	frame: Uint8Array;
	delivery: Exclude<DeliveryClass, "latest-snapshot">;
};

/**
 * Keeps a staged binding silent until the edge graph is published.
 *
 * Latest snapshots coalesce; ordered channel/delta frames remain FIFO and
 * bounded. `activate()` only flips state and schedules the flush, so graph
 * publication itself cannot await or partially fail.
 */
export class RealtimeBindingOutputGate implements ClientSink {
	readonly sessionId: string;
	readonly clientChannel?: string;
	private state: "pending" | "active" | "closed" = "pending";
	private latest: Uint8Array | null = null;
	private ordered: PendingOutput[] = [];
	private bufferedBytes = 0;
	private operation: Promise<void> = Promise.resolve();
	private failure: unknown;

	constructor(
		private readonly sink: ClientSink,
		private readonly options: RealtimeBindingOutputGateOptions,
	) {
		this.sessionId = sink.sessionId;
		this.clientChannel = sink.clientChannel;
	}

	get error(): unknown {
		return this.failure;
	}

	get active(): boolean {
		return this.state === "active";
	}

	reject(error: unknown): void {
		if (this.state !== "pending" || this.failure !== undefined) return;
		this.failure = error;
	}

	assertReady(): void {
		if (this.failure !== undefined) throw this.failure;
	}

	write(frame: Uint8Array, delivery: DeliveryClass): Promise<SinkWriteResult> {
		if (this.state === "closed") {
			return Promise.resolve({ status: "accepted", bufferedBytes: null });
		}
		if (this.state === "active") {
			return this.run(() => this.sink.write(frame, delivery));
		}
		try {
			this.buffer(frame, delivery);
			return Promise.resolve({
				status: "accepted",
				bufferedBytes: this.bufferedBytes,
			});
		} catch (error) {
			this.failure = error;
			return Promise.reject(error);
		}
	}

	close(reason: ClientCloseReason): Promise<void> {
		if (this.state === "pending") {
			const error = new Error(
				`Staged realtime binding requested session close: ${reason}`,
			);
			this.failure = error;
			this.options.onError(error);
			return Promise.resolve();
		}
		return this.state === "active"
			? this.run(() => this.sink.close(reason))
			: Promise.resolve();
	}

	activate(): void {
		if (this.state !== "pending") return;
		this.state = "active";
		const latest = this.latest;
		const ordered = this.ordered;
		this.latest = null;
		this.ordered = [];
		this.bufferedBytes = 0;
		void this.run(async () => {
			if (latest) await this.sink.write(latest, "latest-snapshot");
			for (const output of ordered) {
				await this.sink.write(output.frame, output.delivery);
			}
		}).catch((error) => this.options.onError(error));
	}

	async dispose(): Promise<void> {
		if (this.state === "closed") return;
		this.state = "closed";
		this.latest = null;
		this.ordered = [];
		this.bufferedBytes = 0;
		await this.operation.catch(() => {});
	}

	private buffer(frame: Uint8Array, delivery: DeliveryClass): void {
		if (delivery === "latest-snapshot") {
			if (this.latest) this.bufferedBytes -= this.latest.byteLength;
			this.latest = frame;
			this.bufferedBytes += frame.byteLength;
		} else {
			if (this.ordered.length >= this.options.maximumOrderedEvents) {
				throw new Error("Staged realtime binding event buffer overflow");
			}
			this.ordered.push({ frame, delivery });
			this.bufferedBytes += frame.byteLength;
		}
		if (this.bufferedBytes > this.options.maximumBufferedBytes) {
			throw new Error("Staged realtime binding byte buffer overflow");
		}
	}

	private run<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.operation.then(operation);
		this.operation = result.then(
			() => {},
			() => {},
		);
		return result;
	}
}

function sameSubscription(
	left: RealtimeDesiredSubscription,
	right: RealtimeDesiredSubscription,
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Owns one complete edge-session binding graph.
 *
 * Admission happens before `apply`. `apply` stages every changed binding without
 * exposing it, rolls the whole candidate back on failure/fencing, and publishes
 * one complete map with a single synchronous assignment.
 */
export class RealtimeEdgeSession {
	private bindings: Map<string, RealtimeEdgeBindingEntry>;
	private appliedTopology: RealtimeDesiredTopology;
	private operation: Promise<void> = Promise.resolve();
	private closed = false;

	constructor(
		topology: RealtimeDesiredTopology,
		bindings: Map<string, RealtimeEdgeBindingEntry> = new Map(),
	) {
		this.appliedTopology = topology;
		this.bindings = new Map(bindings);
	}

	get topology(): RealtimeDesiredTopology {
		return this.appliedTopology;
	}

	get size(): number {
		return this.bindings.size;
	}

	has(id: string): boolean {
		return this.bindings.has(id);
	}

	async drop(id: string): Promise<boolean> {
		const entry = this.bindings.get(id);
		if (!entry) return false;
		this.bindings.delete(id);
		await entry.binding.close();
		return true;
	}

	count(kind: RealtimeDesiredSubscription["kind"]): number {
		let count = 0;
		for (const entry of this.bindings.values()) {
			if (entry.subscription.kind === kind) count++;
		}
		return count;
	}

	apply(
		input: RealtimeTopologyApplyInput,
		stage: RealtimeEdgeBindingFactory,
	): Promise<void> {
		const result = this.operation.then(() => this.applyNow(input, stage));
		this.operation = result.catch(() => {});
		return result;
	}

	async close(): Promise<void> {
		this.closed = true;
		await this.operation.catch(() => {});
		const bindings = this.bindings;
		this.bindings = new Map();
		await Promise.allSettled(
			[...bindings.values()].map((entry) => entry.binding.close()),
		);
	}

	private async applyNow(
		input: RealtimeTopologyApplyInput,
		stage: RealtimeEdgeBindingFactory,
	): Promise<void> {
		if (this.closed) throw new Error("Realtime edge session is closed");
		if (input.signal.aborted) throw new Error("Realtime owner is fenced");

		const next = new Map<string, RealtimeEdgeBindingEntry>();
		const staged: RealtimeEdgeBindingEntry[] = [];
		try {
			for (const subscription of input.topology.subscriptions) {
				const current = this.bindings.get(subscription.id);
				if (current && sameSubscription(current.subscription, subscription)) {
					next.set(subscription.id, current);
					continue;
				}
				let binding: RealtimeEdgeBinding;
				try {
					binding = await stage(subscription, {
						ownerGeneration: input.ownerGeneration,
						signal: input.signal,
					});
				} catch (error) {
					throw new RealtimeEdgeBindingStageError(subscription, error);
				}
				const entry = { subscription, binding };
				if (this.closed || input.signal.aborted) {
					await entry.binding.close();
					throw new Error("Realtime owner is fenced");
				}
				staged.push(entry);
				next.set(subscription.id, entry);
			}
		} catch (error) {
			await Promise.allSettled(staged.map((entry) => entry.binding.close()));
			throw error;
		}

		if (this.closed || input.signal.aborted) {
			await Promise.allSettled(staged.map((entry) => entry.binding.close()));
			throw new Error("Realtime owner is fenced");
		}
		for (const entry of staged) {
			try {
				entry.binding.assertReady?.();
			} catch (error) {
				await Promise.allSettled(
					staged.map((candidate) => candidate.binding.close()),
				);
				throw new RealtimeEdgeBindingStageError(entry.subscription, error);
			}
		}

		const previous = this.bindings;
		this.bindings = next;
		this.appliedTopology = input.topology;
		for (const entry of staged) entry.binding.activate();

		await Promise.allSettled(
			[...previous.entries()]
				.filter(([id, entry]) => next.get(id) !== entry)
				.map(([, entry]) => entry.binding.close()),
		);
	}
}
