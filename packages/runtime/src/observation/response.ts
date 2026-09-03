import type { ObservationScope } from "./contract";

function isTransportCancellation(error: unknown): boolean {
	try {
		return (
			typeof error === "object" &&
			error !== null &&
			"name" in error &&
			error.name === "AbortError"
		);
	} catch {
		return false;
	}
}

/** Retains an owned HTTP scope through body EOF, source error, consumer cancel, or host abort. */
export function retainScopeThroughResponse(
	scope: ObservationScope | null,
	response: Response,
	kind: "fetch" | "route" = "fetch",
	signal?: AbortSignal,
	onFinalize?: () => void,
	responseOutcome: "ok" | "framework_error" | "deadline" = "ok",
): Response {
	if (response.body === null) {
		onFinalize?.();
		scope?.end({
			httpResponseStatusCode: response.status,
			kind,
			outcome: signal?.aborted === true ? "cancelled" : responseOutcome,
		});
		return response;
	}
	if (signal?.aborted === true) {
		onFinalize?.();
		scope?.end({
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
	const finalize = (
		outcome: "ok" | "framework_error" | "cancelled" | "deadline",
	) => {
		if (finalized) return;
		finalized = true;
		if (signal !== undefined) signal.removeEventListener("abort", abort);
		onFinalize?.();
		scope?.end({ httpResponseStatusCode: response.status, kind, outcome });
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
					finalize(responseOutcome);
					streamController.close();
					return;
				}
				streamController.enqueue(result.value);
			} catch (error) {
				if (isTransportCancellation(error)) {
					finalize("cancelled");
					try {
						streamController.close();
					} catch {
						/* A disconnected consumer may already be terminal. */
					}
					return;
				}
				finalize("framework_error");
				streamController.error(error);
			}
		},
		async cancel(reason) {
			try {
				await reader.cancel(reason);
			} catch {
				/* Consumer cancellation already owns the terminal response outcome. */
			} finally {
				finalize("cancelled");
			}
		},
	});
	return new Response(body, {
		headers: response.headers,
		status: response.status,
		statusText: response.statusText,
	});
}
