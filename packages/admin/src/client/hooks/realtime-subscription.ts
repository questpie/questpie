import type { RealtimeAPI, TopicConfig } from "questpie/client";

/** @internal Shared direct-subscribe seam used by admin cache invalidation. */
export function subscribeAdminCollectionRealtime(input: {
	client: { realtime?: Pick<RealtimeAPI, "subscribe"> };
	collection: string | undefined;
	topic: TopicConfig | undefined;
	enabled: boolean | undefined;
	onChange: () => void;
}): (() => void) | undefined {
	if (!input.collection || !input.enabled || !input.topic) return;
	const realtimeApi = input.client?.realtime;
	if (!realtimeApi?.subscribe) return;
	return realtimeApi.subscribe(input.topic, input.onChange);
}
