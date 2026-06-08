// runner-smoke.ts — verifies the rewritten runner through the REAL contract
// (createSpawnAgentRunner -> run -> drain events -> await completion), exactly
// like execute-run.ts does. Run: bun packages/ai/runner-smoke.ts codex,opencode
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSpawnAgentRunner } from "./src/server/worker/spawn-agent-runner.ts";

const which = (process.argv[2] ?? "codex,opencode").split(",").map((s) => s.trim());

for (const runtime of which) {
	const workerDir = mkdtempSync(join(tmpdir(), `qp-runner-${runtime}-`));
	const runner = createSpawnAgentRunner({ workerDir, runtimes: [{ runtime } as never], mcpServers: [] });
	const started = Date.now();
	try {
		const handle = await runner.run({
			runtime,
			prompt: "Reply with exactly the single word: PONG. Do not use any tools.",
		});
		let events = 0;
		let text = "";
		const seen = new Set<string>();
		for await (const e of handle.events) {
			events++;
			seen.add(String(e.type));
			if (e.type === "text.delta") text += String(e.text ?? "");
		}
		const completion = await handle.completion;
		console.log(`\n=== ${runtime} (real runner contract) ===`);
		console.log(JSON.stringify({ ok: true, ms: Date.now() - started, events, eventTypes: [...seen], text: text.slice(0, 120), completion }, null, 2));
	} catch (e) {
		console.log(`\n=== ${runtime} (real runner contract) ===`);
		console.log(JSON.stringify({ ok: false, ms: Date.now() - started, error: String((e as Error)?.message ?? e) }, null, 2));
	}
}
process.exit(0);
