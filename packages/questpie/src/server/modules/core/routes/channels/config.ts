import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

import {
	channelRouteError,
	channelRouteResponse,
	validateChannelRouteOrigin,
} from "./_shared.js";

/** Public client transport metadata. Provider secrets never enter this shape. */
export default route()
	.get()
	.access(true)
	.raw()
	.handler(async (ctx) => {
		let origin: string | null = null;
		try {
			origin = validateChannelRouteOrigin(ctx, false);
			const config = await routeApp(ctx).realtime?.getClientTransportConfig({
				request: ctx.request,
			});
			return channelRouteResponse(config ?? { transport: "sse" }, 200, origin);
		} catch (error) {
			return channelRouteError(error, origin);
		}
	});
