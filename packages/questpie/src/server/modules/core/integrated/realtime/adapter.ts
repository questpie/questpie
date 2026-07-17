import type { RealtimeChangeEvent, RealtimeNotice } from "./types.js";

export type RealtimeAdapterState = "connected" | "disconnected";

/**
 * Transport adapter for realtime change notifications.
 * @deprecated Use a notice-only ChangeBroker. RealtimeAdapter remains available
 * through QuestPie 3.x and is scheduled for removal in QuestPie 4.
 */
export interface RealtimeAdapter {
	/** Prepare the publish side without requiring a local subscription. */
	startPublisher?(): Promise<void>;
	start(): Promise<void>;
	stop(): Promise<void>;
	notify(event: RealtimeChangeEvent): Promise<void>;
	subscribe(handler: (notice: RealtimeNotice) => void): () => void;
	onStateChange?(handler: (state: RealtimeAdapterState) => void): () => void;
}
