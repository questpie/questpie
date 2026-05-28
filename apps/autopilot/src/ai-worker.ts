import { startAIWorker } from "@questpie/ai/worker";

import { app } from "#questpie";

await startAIWorker(app, {
	runtimes: [{ runtime: "claude-code" }],
});
