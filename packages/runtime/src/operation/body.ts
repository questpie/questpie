export type BoundedRequestBody =
	| Readonly<{ kind: "body"; text: string }>
	| Readonly<{ kind: "invalid" }>
	| Readonly<{ kind: "tooLarge" }>;

export async function readBoundedRequestBody(
	request: Request,
	maximumBytes: number,
	signal: AbortSignal = request.signal,
): Promise<BoundedRequestBody> {
	const contentLength = request.headers.get("content-length");
	if (contentLength !== null) {
		if (!/^(0|[1-9][0-9]*)$/.test(contentLength))
			return Object.freeze({ kind: "invalid" });
		const declared = Number(contentLength);
		if (!Number.isSafeInteger(declared))
			return Object.freeze({ kind: "invalid" });
		if (declared > maximumBytes) return Object.freeze({ kind: "tooLarge" });
	}
	if (!request.body) return Object.freeze({ kind: "body", text: "" });
	const reader = request.body.getReader();
	const cancel = () => {
		try {
			void reader.cancel(signal.reason).catch(() => undefined);
		} catch {
			// Cancellation is best-effort; the execution signal owns the failure.
		}
	};
	signal.addEventListener("abort", cancel, { once: true });
	if (signal.aborted) cancel();
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let bytes = 0;
	let text = "";
	let pendingRead: ReturnType<typeof reader.read> | undefined;
	try {
		if (signal.aborted) throw signal.reason;
		while (true) {
			const read = reader.read();
			pendingRead = read;
			void read.catch(() => undefined);
			let rejectAbort: ((reason?: unknown) => void) | undefined;
			const aborted = new Promise<never>((_resolve, reject) => {
				rejectAbort = reject;
			});
			const abortRead = () => rejectAbort?.(signal.reason);
			signal.addEventListener("abort", abortRead, { once: true });
			if (signal.aborted) abortRead();
			let next: Awaited<typeof read>;
			try {
				next = await Promise.race([read, aborted]);
				pendingRead = undefined;
			} finally {
				signal.removeEventListener("abort", abortRead);
				rejectAbort = undefined;
			}
			if (next.done) break;
			bytes += next.value.byteLength;
			if (bytes > maximumBytes) {
				try {
					void reader
						.cancel("QUESTPIE request limit exceeded")
						.catch(() => undefined);
				} catch {
					// The body limit remains the transport outcome.
				}
				return Object.freeze({ kind: "tooLarge" });
			}
			text += decoder.decode(next.value, { stream: true });
		}
		text += decoder.decode();
		return Object.freeze({ kind: "body", text });
	} catch (error) {
		if (signal.aborted) throw signal.reason;
		if (error instanceof TypeError) return Object.freeze({ kind: "invalid" });
		throw error;
	} finally {
		signal.removeEventListener("abort", cancel);
		if (pendingRead === undefined) reader.releaseLock();
		else
			void pendingRead
				.finally(() => {
					try {
						reader.releaseLock();
					} catch {
						// The already selected transport outcome remains authoritative.
					}
				})
				.catch(() => undefined);
	}
}
