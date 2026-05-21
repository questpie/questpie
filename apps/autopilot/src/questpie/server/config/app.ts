import { appConfig } from "questpie/app";
import type { GlobalCollectionHookContext } from "questpie";

import { mirrorAiRunCollectionChange } from "../lib/ai-run-mirror";

async function publishCollectionChange(
	ctx: GlobalCollectionHookContext,
	operation: "create" | "update" | "delete",
) {
	const recordId =
		typeof ctx.data?.id === "string" || typeof ctx.data?.id === "number"
			? String(ctx.data.id)
			: null;

	ctx.onAfterCommit(async () => {
		try {
			const change = await ctx.realtime.appendChange({
				resourceType: "collection",
				resource: ctx.collection,
				operation,
				recordId,
				locale: ctx.locale ?? null,
				payload: ctx.data ?? {},
			});
			await ctx.realtime.notify(change);
		} catch (error) {
			ctx.logger?.warn?.("Failed to publish realtime collection change", {
				collection: ctx.collection,
				operation,
				recordId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	});
}

export default appConfig({
	locale: {
		locales: [{ code: "en", fallback: true }],
		defaultLocale: "en",
	},
	hooks: {
		collections: {
			afterChange: async (ctx) => {
				await publishCollectionChange(ctx, ctx.operation);
				ctx.onAfterCommit(async () => {
					await mirrorAiRunCollectionChange(ctx);
				});
			},
			afterDelete: async (ctx) => {
				await publishCollectionChange(ctx, "delete");
			},
		},
	},
});
