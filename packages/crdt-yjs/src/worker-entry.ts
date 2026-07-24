import { createYjsTextEngineCore } from "./text-engine.js";
import type {
	YjsWorkerOperation,
	YjsWorkerResponse,
} from "./worker-protocol.js";

/* oxlint-disable unicorn/require-post-message-target-origin -- Worker.postMessage has no target origin. */
declare const self: Worker;

const engine = createYjsTextEngineCore();

self.addEventListener(
	"message",
	async (event: MessageEvent<YjsWorkerOperation>) => {
		try {
			const operation = event.data;
			const value = await engine.stage(operation.input);
			self.postMessage({ ok: true, value } satisfies YjsWorkerResponse);
		} catch (error) {
			self.postMessage({
				ok: false,
				message: error instanceof Error ? error.message : "Yjs worker failed",
			} satisfies YjsWorkerResponse);
		}
	},
);
/* oxlint-enable unicorn/require-post-message-target-origin */
