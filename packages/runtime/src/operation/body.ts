export type BoundedRequestBody =
	| Readonly<{ kind: "body"; text: string }>
	| Readonly<{ kind: "invalid" }>
	| Readonly<{ kind: "tooLarge" }>;

export async function readBoundedRequestBody(
	request: Request,
	maximumBytes: number,
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
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let bytes = 0;
	let text = "";
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			bytes += next.value.byteLength;
			if (bytes > maximumBytes) {
				await reader.cancel("QUESTPIE request limit exceeded");
				return Object.freeze({ kind: "tooLarge" });
			}
			text += decoder.decode(next.value, { stream: true });
		}
		text += decoder.decode();
		return Object.freeze({ kind: "body", text });
	} catch (error) {
		if (request.signal.aborted) throw request.signal.reason;
		if (error instanceof TypeError) return Object.freeze({ kind: "invalid" });
		throw error;
	} finally {
		reader.releaseLock();
	}
}
