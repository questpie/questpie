import type { TopicConfig } from "./multiplexer.js";

export type RealtimeSubscriber = (data: unknown) => void;
export type RealtimeErrorCallback = (error: Error) => void;

/** Client-side delivery seam shared by SSE and managed-Pusher live queries. */
export interface RealtimeClientTransport {
	subscribe(
		topic: TopicConfig,
		callback: RealtimeSubscriber,
		signal?: AbortSignal,
		customId?: string,
		onError?: RealtimeErrorCallback,
	): () => void;
	destroy(): void;
	readonly topicCount: number;
	readonly subscriberCount: number;
}
