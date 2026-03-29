import type { RealtimeChangeEvent, RealtimeNotice } from "./types.js";

/**
 * Transport adapter for realtime change notifications.
 */
export interface RealtimeAdapter {
	start(): Promise<void>;
	stop(): Promise<void>;
	notify(event: RealtimeChangeEvent): Promise<void>;
	subscribe(handler: (notice: RealtimeNotice) => void): () => void;
}
