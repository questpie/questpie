import { createYjsTextEngineCore } from "./text-engine.js";
import type {
	YjsWorkerOperation,
	YjsWorkerResponse,
} from "./worker-protocol.js";

type WorkerEndpoint = {
	post(message: YjsWorkerResponse): void;
	onMessage(listener: (operation: YjsWorkerOperation) => void): void;
};

const engine = createYjsTextEngineCore();
const endpoint = await createWorkerEndpoint();
endpoint.post({ type: "ready" });

endpoint.onMessage(async (operation) => {
	try {
		const memoryBefore = measuredMemory();
		const value = await engine.stage(operation.input);
		const memoryAfter = measuredMemory();
		if (
			memoryBefore &&
			memoryAfter &&
			(memoryAfter.arrayBuffers - memoryBefore.arrayBuffers >
				64 * 1024 * 1024 ||
				memoryAfter.rss - memoryBefore.rss > 64 * 1024 * 1024)
		) {
			throw new Error("Yjs worker exceeded measured memory ceiling");
		}
		endpoint.post({
			type: "result",
			id: operation.id,
			ok: true,
			value,
		});
	} catch (error) {
		endpoint.post({
			type: "result",
			id: operation.id,
			ok: false,
			message: error instanceof Error ? error.message : "Yjs worker failed",
		});
	}
});

async function createWorkerEndpoint(): Promise<WorkerEndpoint> {
	/* oxlint-disable unicorn/require-post-message-target-origin -- Worker and worker_threads postMessage do not accept a target origin. */
	if (
		typeof globalThis.postMessage === "function" &&
		typeof globalThis.addEventListener === "function"
	) {
		return {
			post: (message) => globalThis.postMessage(message),
			onMessage: (listener) =>
				globalThis.addEventListener("message", (event) =>
					listener((event as MessageEvent<YjsWorkerOperation>).data),
				),
		};
	}
	const { parentPort } = await import("node:worker_threads");
	if (!parentPort) throw new Error("Yjs worker has no parent port");
	return {
		post: (message) => parentPort.postMessage(message),
		onMessage: (listener) => parentPort.on("message", listener),
	};
	/* oxlint-enable unicorn/require-post-message-target-origin */
}

function measuredMemory():
	| Readonly<{ arrayBuffers: number; rss: number }>
	| undefined {
	if (
		typeof process === "undefined" ||
		typeof process.memoryUsage !== "function"
	) {
		return undefined;
	}
	const usage = process.memoryUsage();
	return { arrayBuffers: usage.arrayBuffers, rss: usage.rss };
}
