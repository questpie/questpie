import type { GlobalCollectionHookContext } from "questpie";

import type { AppCollections } from "./app-types";

type ChatRunStatus =
	| "pending"
	| "claimed"
	| "running"
	| "completed"
	| "failed"
	| "cancelled";

function statusFrom(value: unknown) {
	return typeof value === "string" ? value : null;
}

function isChatRunStatus(value: string): value is ChatRunStatus {
	return (
		value === "pending" ||
		value === "claimed" ||
		value === "running" ||
		value === "completed" ||
		value === "failed" ||
		value === "cancelled"
	);
}

async function mirrorChatRunStatus(
	collections: AppCollections,
	runId: string,
	status: ChatRunStatus,
) {
	const messages = await collections.chat_messages.find({
		where: { run: runId },
		limit: 100,
	});
	await Promise.all(
		messages.docs.map((message) =>
			collections.chat_messages.updateById({
				id: message.id,
				data: { runStatus: status },
			}),
		),
	);
}

export async function mirrorRunLinkChatStatus(ctx: GlobalCollectionHookContext) {
	if (ctx.collection !== "run_links" || !ctx.data?.id) return;
	const status = statusFrom(ctx.data.status);
	if (!status) return;
	if (isChatRunStatus(status)) {
		await mirrorChatRunStatus(ctx.collections, String(ctx.data.id), status);
	}
}

// Kept export name (app.ts global afterChange hook imports it): the legacy
// ai_runs / ai_run_events relay is deleted, so this now only dispatches
// run_links changes to the chat-status mirror.
export async function mirrorAiRunCollectionChange(
	ctx: GlobalCollectionHookContext,
) {
	await mirrorRunLinkChatStatus(ctx);
}
