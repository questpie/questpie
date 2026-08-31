import type { ObservationScope } from "./contract";

/** Retains an owned HTTP scope through body EOF, source error, consumer cancel, or host abort. */
export function retainScopeThroughResponse(
	scope: ObservationScope,
	response: Response,
	kind: "fetch" | "route" = "fetch",
	signal?: AbortSignal,
): Response {
	if (response.body === null) {
		scope.end({
			httpResponseStatusCode: response.status,
			kind,
			outcome: signal?.aborted === true ? "cancelled" : "ok",
		});
		return response;
	}
	if (signal?.aborted === true) {
		scope.end({
			httpResponseStatusCode: response.status,
			kind,
			outcome: "cancelled",
		});
		try {
			const retained = response.clone();
			void response.body.cancel(signal.reason).catch(() => undefined);
			return retained;
		} catch {
			/* Preserving an already-created Response remains authoritative. */
		}
		return response;
	}
	const reader = response.body.getReader();
	let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
	let finalized = false;
	const finalize = (outcome: "ok" | "framework_error" | "cancelled") => {
		if (finalized) return;
		finalized = true;
		if (signal !== undefined) signal.removeEventListener("abort", abort);
		scope.end({ httpResponseStatusCode: response.status, kind, outcome });
	};
	const abort = () => {
		finalize("cancelled");
		try {
			controller?.error(signal?.reason);
		} catch {
			/* Downstream is terminal. */
		}
		void reader.cancel(signal?.reason).catch(() => undefined);
	};
	const body = new ReadableStream<Uint8Array>({
		start(streamController) {
			controller = streamController;
			if (signal?.aborted === true) abort();
			else signal?.addEventListener("abort", abort, { once: true });
		},
		async pull(streamController) {
			if (finalized) return;
			try {
				const result = await reader.read();
				if (finalized) return;
				if (result.done) {
					finalize("ok");
					streamController.close();
					return;
				}
				streamController.enqueue(result.value);
			} catch (error) {
				finalize("framework_error");
				streamController.error(error);
			}
		},
		cancel(reason) {
			finalize("cancelled");
			void reader.cancel(reason).catch(() => undefined);
		},
	});
	return new Response(body, {
		headers: response.headers,
		status: response.status,
		statusText: response.statusText,
	});
}
