import { route } from "#questpie/server/routes/define-route.js";

import {
	channelRouteHeaders,
	channelRouteResponse,
	observeChannelSecurity,
	validateChannelPreflight,
	validateChannelRouteOrigin,
} from "./_shared.js";

export default route()
	.options()
	.access(true)
	.raw()
	.handler((ctx) => {
		try {
			const origin = validateChannelRouteOrigin(ctx);
			validateChannelPreflight(ctx.request);
			return new Response(null, {
				status: 204,
				headers: channelRouteHeaders(origin),
			});
		} catch {
			observeChannelSecurity(ctx, {
				verb: "origin",
				outcome: "denied",
				reason: "origin_denied",
			});
			return channelRouteResponse(
				{ error: "channel_origin_denied" },
				403,
				null,
			);
		}
	});
