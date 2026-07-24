import { createYjsTextEngineCore } from "./text-engine.js";
import type {
	YjsWorkerOperation,
	YjsWorkerResponse,
} from "./worker-protocol.js";

/* oxlint-disable unicorn/require-post-message-target-origin -- Worker.postMessage has no target origin. */
declare const self: Worker;

const engine = createYjsTextEngineCore();
self.postMessage({ type: "ready" } satisfies YjsWorkerResponse);

self.addEventListener(
	"message",
	async (event: MessageEvent<YjsWorkerOperation>) => {
		try {
			const operation = event.data;
			const memoryBefore = process.memoryUsage();
			const value = await engine.stage(operation.input);
			const memoryAfter = process.memoryUsage();
			if (
				memoryAfter.arrayBuffers - memoryBefore.arrayBuffers >
					64 * 1024 * 1024 ||
				memoryAfter.rss - memoryBefore.rss > 64 * 1024 * 1024
			) {
				throw new Error("Yjs worker exceeded measured memory ceiling");
			}
			self.postMessage({
				type: "result",
				id: operation.id,
				ok: true,
				value,
			} satisfies YjsWorkerResponse);
		} catch (error) {
			self.postMessage({
				type: "result",
				id: event.data.id,
				ok: false,
				message: error instanceof Error ? error.message : "Yjs worker failed",
			} satisfies YjsWorkerResponse);
		}
	},
);
/* oxlint-enable unicorn/require-post-message-target-origin */
