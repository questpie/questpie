type Finalize = () => Promise<void>;

export async function retainResponseLifetime(
	response: Response,
	signal: AbortSignal,
	finalize: Finalize,
): Promise<Response> {
	if (!response.body) {
		await finalize();
		return response;
	}
	const reader = response.body.getReader();
	let completion: Promise<void> | undefined;
	const complete = (): Promise<void> => {
		completion ??= finalize();
		return completion;
	};
	const onAbort = () => {
		void reader
			.cancel(signal.reason)
			.catch(() => undefined)
			.then(complete)
			.catch(() => undefined);
	};
	if (signal.aborted) onAbort();
	else signal.addEventListener("abort", onAbort, { once: true });

	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const next = await reader.read();
				if (!next.done) {
					controller.enqueue(next.value);
					return;
				}
				await complete();
				signal.removeEventListener("abort", onAbort);
				controller.close();
			} catch (error) {
				try {
					await complete();
				} finally {
					signal.removeEventListener("abort", onAbort);
					controller.error(error);
				}
			}
		},
		async cancel(reason) {
			try {
				await reader.cancel(reason);
			} finally {
				await complete();
				signal.removeEventListener("abort", onAbort);
			}
		},
	});
	return new Response(body, {
		headers: response.headers,
		status: response.status,
		statusText: response.statusText,
	});
}
