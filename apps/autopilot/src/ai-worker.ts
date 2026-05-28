import { startAIWorker } from "@questpie/ai/worker";

import { createContext } from "#questpie";

// startAIWorker needs resolved services (workerManager), which live on a
// context, not the bare app instance — so run it within a system context.
const ctx = await createContext({ accessMode: "system" });

await startAIWorker(ctx, {
	runtimes: [{ runtime: "claude-code" }],
});
