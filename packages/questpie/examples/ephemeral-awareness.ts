import {
	channel,
	type ChannelAuthorizationRule,
	type ChannelPresenceResolver,
} from "questpie/channels";
import { z } from "zod";

/** Put the returned definition in channels/page.ts. Supply the same read check
 * as the page query, and resolve member identity on the server.
 */
export function pageAwareness(
	canReadPage: ChannelAuthorizationRule<"page-awareness-[pageId]">,
	member: ChannelPresenceResolver<"page-awareness-[pageId]">,
) {
	return channel("page-awareness-[pageId]")
		.ephemeral({ coalesceMs: 100 })
		.events({
			cursor: z.object({
				actorId: z.string(),
				x: z.number(),
				y: z.number(),
				at: z.number(),
			}),
			typing: z.object({
				actorId: z.string(),
				active: z.boolean(),
				at: z.number(),
			}),
		})
		.authorize({ subscribe: canReadPage, publish: false })
		.presence(member);
}

/** Call from a server command AFTER checking page access and resolving actorId.
 * Use a system-bound channels service; browser publishing stays disabled.
 * The key keeps independent actors separate when one server publishes for many.
 */
export async function announceCursor(
	channels: {
		page(params: { pageId: string }): {
			publish(
				event: "cursor",
				data: { actorId: string; x: number; y: number; at: number },
				options: { coalesceKey: string },
			): Promise<unknown>;
		};
	},
	input: { pageId: string; actorId: string; x: number; y: number },
) {
	const { pageId, actorId, x, y } = input;
	await channels
		.page({ pageId })
		.publish(
			"cursor",
			{ actorId, x, y, at: Date.now() },
			{ coalesceKey: actorId },
		);
}
