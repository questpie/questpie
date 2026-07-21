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
};

/** Connection-local reconciliation state for optimistic mutation txids. */
export class RealtimeTxidTracker {
	private watermark: bigint | undefined;
	private readonly exactTxids = new Set<string>();
	private readonly pending = new Map<string, Set<PendingWaiter>>();

	constructor(private readonly maximumExactTxids = 1024) {}

	observe(event: RealtimeStreamEvent): void {
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
		if (
			watermark !== undefined &&
			(this.watermark === undefined || watermark > this.watermark)
		) {
			this.watermark = watermark;
		}

		for (const [txid, waiters] of this.pending) {
			if (!this.isResolved(txid)) continue;
			this.pending.delete(txid);
			for (const waiter of waiters) {
				waiter.dispose();
				waiter.resolve();
			}
		}
	}

	awaitTxId(txid: string, signal?: AbortSignal): Promise<void> {
		if (this.isResolved(txid)) return Promise.resolve();
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
		this.watermark = undefined;
	}

	private isResolved(txid: string): boolean {
		if (this.exactTxids.has(txid)) return true;
		const pending = asTxid(txid);
		return (
			pending !== undefined &&
			this.watermark !== undefined &&
			this.watermark > pending
		);
	}
}
