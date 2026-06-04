// e2e-run.ts — turn-on smoke: create a task, trigger task-pipeline, poll to terminal.
// Requires `bun run worker` (queue) + `bun run ai-worker` running in background.
import { createContext } from "#questpie";
import { workflowsFromContext } from "../src/questpie/server/lib/workflows";

const ctx = await createContext({ accessMode: "system" });

const task = await ctx.collections.tasks.create({
	title: "E2E smoke: reply with one sentence",
	description:
		"Reply with exactly one short sentence confirming you ran: \"Autopilot e2e OK\". Do not use any tools and do not edit any files.",
	type: "task",
	status: "pending",
	priority: "medium",
	scopeType: "company",
	createdBy: "e2e",
});

const wf = await workflowsFromContext(ctx).trigger(
	"task-pipeline",
	{ taskId: task.id, runReason: "e2e", requestedBy: "e2e" },
	{ idempotencyKey: `task-pipeline:${task.id}` },
);
console.log("[e2e] task:", task.id, "wf:", wf.instanceId, "existing:", wf.existing);

function docsOf(r: any): any[] {
	return Array.isArray(r) ? r : (r?.docs ?? []);
}

const deadline = Date.now() + 4 * 60 * 1000;
let last = "";
while (Date.now() < deadline) {
	const t = await ctx.collections.tasks.findOne({ where: { id: task.id } });
	const links = await ctx.collections.run_links.find({
		where: { task: task.id },
		limit: 5,
	});
	const rl = docsOf(links)[0];
	const snap = JSON.stringify({
		task: (t as any)?.status,
		run: rl?.status,
		runtime: rl?.runtime,
		summary: String(rl?.summary ?? "").slice(0, 100),
	});
	if (snap !== last) {
		console.log("[e2e]", new Date().toISOString(), snap);
		last = snap;
	}
	const taskStatus = (t as any)?.status;
	if (
		taskStatus === "review" ||
		taskStatus === "failed" ||
		taskStatus === "cancelled" ||
		rl?.status === "completed" ||
		rl?.status === "failed"
	) {
		console.log("[e2e] TERMINAL:", snap);
		if (rl) console.log("[e2e] run.summary:", rl.summary, "| run.error:", rl.error);
		break;
	}
	await new Promise((r) => setTimeout(r, 4000));
}
process.exit(0);
