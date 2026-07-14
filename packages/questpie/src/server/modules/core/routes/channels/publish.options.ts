import { route } from "#questpie/server/routes/define-route.js";

import {
	channelRouteHeaders,
	channelRouteResponse,
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
			return channelRouteResponse(
				{ error: "channel_origin_denied" },
				403,
				null,
			);
		}
	});
