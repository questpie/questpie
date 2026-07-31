import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

import {
	channelRouteError,
	channelRouteResponse,
	channelSecurityReason,
	observeChannelSecurity,
	parseChannelAuthRequest,
	principalOf,
	requestChannels,
	validateChannelRouteOrigin,
} from "./_shared.js";

/** Authorize a generated channel key/params identity for one provider socket. */
export default route()
	.post()
	.access(true)
	.raw()
	.handler(async (ctx) => {
		let origin: string | null = null;
		try {
			origin = validateChannelRouteOrigin(ctx);
			const input = await parseChannelAuthRequest(ctx.request);
			const channels = requestChannels(ctx);
			const resolvedName = channels.resolveName(input.channel, input.params);
			if (resolvedName !== input.channelName) {
				throw new Error("Channel name does not match generated identity");
			}
			const definition = channels.getDefinition(input.channel);
			const realtime = routeApp(ctx).realtime;
			if (!realtime) {
				observeChannelSecurity(ctx, {
					verb: "grant",
					outcome: "denied",
					reason: "transport_unavailable",
				});
				return channelRouteResponse(
					{ error: "channel_transport_unavailable" },
					404,
					origin,
				);
			}
			const auth = await realtime.generateAuthorizedClientAuth(
				{
					socketId: input.socketId,
					channel: resolvedName,
					principal: principalOf(ctx),
					scope: "channel",
				},
				async () => {
					if (definition.visibility === "presence") {
						const resolved = await channels.resolvePresence(
							input.channel,
							input.params,
						);
						return resolved && typeof resolved === "object"
							? {
									presence: {
										user_info: resolved as Record<string, unknown>,
									},
								}
							: {};
					}
					if (
						!(await channels.authorize(
							input.channel,
							input.params,
							"subscribe",
						))
					) {
						observeChannelSecurity(ctx, {
							verb: "subscribe",
							outcome: "denied",
							reason: "access_denied",
						});
						throw new Error("Channel subscription is not authorized");
					}
					return {};
				},
			);
			observeChannelSecurity(ctx, {
				verb: definition.visibility === "presence" ? "presence" : "subscribe",
				outcome: "allowed",
				reason: "allowed",
			});
			return channelRouteResponse(auth, 200, origin);
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
