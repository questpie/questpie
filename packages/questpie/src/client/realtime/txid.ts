import { getTxid } from "../../shared/txid.js";
import type { RealtimeStreamEvent } from "./stream.js";

function asTxid(value: string | undefined): bigint | undefined {
	if (value === undefined) return undefined;
	try {
		return BigInt(value);
	} catch {
		return undefined;
	}
}

/** Exact mutation txids resolve immediately; watermarks resolve only when strictly newer. */
export function realtimeEventResolvesTxid(
	txid: string,
	event: RealtimeStreamEvent,
): boolean {
	if ("txid" in event && event.txid === txid) return true;
	const pending = asTxid(txid);
	const watermark = asTxid("upToDate" in event ? event.upToDate : undefined);
	return (
		pending !== undefined && watermark !== undefined && watermark > pending
	);
}

type PendingWaiter = {
	resolve: () => void;
	reject: (error: Error) => void;
	dispose: () => void;
	requiredTopics?: Set<object>;
};

/** Connection-local reconciliation state for optimistic mutation txids. */
export class RealtimeTxidTracker {
	private legacyWatermark: bigint | undefined;
	private readonly topicWatermarks = new Map<object, bigint | undefined>();
	private readonly exactTxids = new Set<string>();
	private readonly pending = new Map<string, Set<PendingWaiter>>();

	constructor(private readonly maximumExactTxids = 1024) {}

	registerTopic(): object {
		const token = {};
		this.topicWatermarks.set(token, undefined);
		return token;
	}

	unregisterTopic(token: object): void {
		if (!this.topicWatermarks.delete(token)) return;
		for (const waiters of this.pending.values()) {
			for (const waiter of waiters) waiter.requiredTopics?.delete(token);
		}
		this.settleResolved();
	}

	observe(event: RealtimeStreamEvent, topicToken?: object): void {
		const eventTxid = "txid" in event ? event.txid : undefined;
		if (eventTxid) {
			this.exactTxids.delete(eventTxid);
			this.exactTxids.add(eventTxid);
			while (this.exactTxids.size > this.maximumExactTxids) {
				const oldest = this.exactTxids.values().next().value;
				if (oldest === undefined) break;
				this.exactTxids.delete(oldest);
			}
		}
		const watermark = asTxid("upToDate" in event ? event.upToDate : undefined);
		if (watermark !== undefined) {
			if (topicToken && this.topicWatermarks.has(topicToken)) {
				const current = this.topicWatermarks.get(topicToken);
				if (current === undefined || watermark > current) {
					this.topicWatermarks.set(topicToken, watermark);
				}
			} else if (
				this.legacyWatermark === undefined ||
				watermark > this.legacyWatermark
			) {
				this.legacyWatermark = watermark;
			}
		}
		this.settleResolved();
	}

	private settleResolved(): void {
		for (const [txid, waiters] of this.pending) {
			for (const waiter of waiters) {
				if (!this.isResolved(txid, waiter.requiredTopics)) continue;
				waiters.delete(waiter);
				waiter.dispose();
				waiter.resolve();
			}
			if (waiters.size === 0) this.pending.delete(txid);
		}
	}

	awaitTxId(txid: string, signal?: AbortSignal): Promise<void> {
		const requiredTopics =
			this.topicWatermarks.size > 0
				? new Set(this.topicWatermarks.keys())
				: undefined;
		if (this.isResolved(txid, requiredTopics)) return Promise.resolve();
		if (signal?.aborted) return Promise.reject(signal.reason);

		return new Promise<void>((resolve, reject) => {
			const waiters = this.pending.get(txid) ?? new Set<PendingWaiter>();
			const onAbort = () => {
				waiters.delete(waiter);
				if (waiters.size === 0) this.pending.delete(txid);
				reject(
					signal?.reason instanceof Error
						? signal.reason
						: new Error("Realtime txid wait aborted"),
				);
			};
			const waiter: PendingWaiter = {
				resolve,
				reject,
				dispose: () => signal?.removeEventListener("abort", onAbort),
				requiredTopics,
			};
			waiters.add(waiter);
			this.pending.set(txid, waiters);
			signal?.addEventListener("abort", onAbort, { once: true });
		});
	}

	awaitMutation(result: unknown, signal?: AbortSignal): Promise<void> {
		const txid = getTxid(result);
		return txid ? this.awaitTxId(txid, signal) : Promise.resolve();
	}

	clear(error = new Error("Realtime txid tracker was destroyed")): void {
		for (const waiters of this.pending.values()) {
			for (const waiter of waiters) {
				waiter.dispose();
				waiter.reject(error);
			}
		}
		this.pending.clear();
		this.exactTxids.clear();
		this.topicWatermarks.clear();
		this.legacyWatermark = undefined;
	}

	private isResolved(txid: string, requiredTopics?: Set<object>): boolean {
		if (this.exactTxids.has(txid)) return true;
		const pending = asTxid(txid);
		if (pending === undefined) return false;
		if (requiredTopics) {
			return [...requiredTopics].every((topic) => {
				const watermark = this.topicWatermarks.get(topic);
				return watermark !== undefined && watermark > pending;
			});
		}
		return this.legacyWatermark !== undefined && this.legacyWatermark > pending;
	}
}
