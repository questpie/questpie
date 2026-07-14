/** @internal Shared direct-subscribe seam used by admin cache invalidation. */
export function subscribeAdminCollectionRealtime(input: {
	client: any;
	collection: string | undefined;
	topic: unknown;
	enabled: boolean | undefined;
	onChange: () => void;
}): (() => void) | undefined {
	if (!input.collection || !input.enabled || !input.topic) return;
	const realtimeApi = input.client?.realtime;
	if (!realtimeApi?.subscribe) return;
	return realtimeApi.subscribe(input.topic, input.onChange);
}
