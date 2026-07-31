/** Keep application callbacks from interrupting channel lifecycle bookkeeping. */
export function notifyChannelConsumer<T>(
	callback: ((value: T) => void) | undefined,
	value: T,
): void {
	try {
		callback?.(value);
	} catch {
		// Consumer failures belong to the application, not the shared transport.
	}
}
