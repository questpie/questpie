import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

import {
	channelRouteError,
	channelRouteResponse,
	channelSecurityReason,
	observeChannelSecurity,
	parseChannelReplayRequest,
	requestChannels,
	validateChannelRouteOrigin,
} from "./_shared.js";

/** Reauthorize and drain one bounded ordered-channel replay page. */
export default route()
	.post()
	.access(true)
	.raw()
	.handler(async (ctx) => {
		let origin: string | null = null;
		try {
			origin = validateChannelRouteOrigin(ctx);
			const input = await parseChannelReplayRequest(ctx.request);
			const channels = requestChannels(ctx);
			const definition = channels.getDefinition(input.channel);
			const resolvedName = channels.resolveName(input.channel, input.params);
			let allowed = true;
			if (definition.visibility === "presence") {
				await channels.resolvePresence(input.channel, input.params);
			} else {
				allowed = await channels.authorize(
					input.channel,
					input.params,
					"subscribe",
				);
			}
			if (!allowed) {
				observeChannelSecurity(ctx, {
					verb: "subscribe",
					outcome: "denied",
					reason: "access_denied",
				});
				return channelRouteResponse(
					{ error: "channel_subscribe_denied" },
					403,
					origin,
				);
			}
			const realtime = routeApp(ctx).realtime;
			if (!realtime) {
				return channelRouteResponse(
					{ error: "channel_transport_unavailable" },
					404,
					origin,
				);
			}
			const page = await realtime.replayChannelEvents(
				resolvedName,
				input.afterEventId,
			);
			observeChannelSecurity(ctx, {
				verb: "subscribe",
				outcome: "allowed",
				reason: "allowed",
			});
			return channelRouteResponse(page, 200, origin);
		} catch (error) {
			observeChannelSecurity(ctx, {
				verb: "subscribe",
				outcome: "denied",
				reason: channelSecurityReason(error),
			});
			if (error instanceof Error && "status" in error) {
				const status = Number((error as { status: unknown }).status);
				return channelRouteResponse(
					{
						error:
							status === 415
								? "channel_content_type_invalid"
								: "channel_request_invalid",
					},
					status,
					origin,
				);
			}
			return channelRouteError(error, origin);
		}
	});
