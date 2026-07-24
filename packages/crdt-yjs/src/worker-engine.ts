import { CrdtEngineError, type CrdtFieldEngine } from "questpie/crdt";

import { createYjsTextEngineCore } from "./text-engine.js";
import type {
	YjsWorkerOperation,
	YjsWorkerResponse,
} from "./worker-protocol.js";

export type YjsTextEngineOptions = Readonly<{
	operationTimeoutMs?: number;
}>;

export function createYjsTextEngine(
	options: YjsTextEngineOptions = {},
): CrdtFieldEngine<"text", string> {
	const core = createYjsTextEngineCore();
	const timeout = options.operationTimeoutMs ?? 5_000;
	if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000) {
		throw new CrdtEngineError("invalid Yjs worker timeout");
	}
	return Object.freeze({
		...core,
		stage: (input: Parameters<typeof core.stage>[0]) =>
			execute<Awaited<ReturnType<typeof core.stage>>>(
				{ method: "stage", input },
				timeout,
			),
	});
}

async function execute<T>(
	operation: YjsWorkerOperation,
	timeoutMs: number,
): Promise<T> {
	const workerEntry = import.meta.url.endsWith(".ts")
		? "./worker-entry.ts"
		: "./worker-entry.mjs";
	const worker = new Worker(new URL(workerEntry, import.meta.url), {
		type: "module",
	});
	try {
		return await new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				void worker.terminate();
				reject(new CrdtEngineError("Yjs worker operation timed out"));
			}, timeoutMs);
			worker.addEventListener(
				"message",
				(event: MessageEvent<YjsWorkerResponse>) => {
					clearTimeout(timer);
					if (event.data.ok) resolve(event.data.value as T);
					else reject(new CrdtEngineError(event.data.message));
				},
			);
			worker.addEventListener("error", () => {
				clearTimeout(timer);
				reject(new CrdtEngineError("Yjs worker operation failed"));
			});
			// oxlint-disable-next-line unicorn/require-post-message-target-origin -- Worker.postMessage has no target origin.
			worker.postMessage(operation);
		});
	} finally {
		await worker.terminate();
	}
}
