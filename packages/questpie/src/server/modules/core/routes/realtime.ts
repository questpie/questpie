/**
 * Realtime SSE route — multiplexed realtime subscriptions.
 *
 * POST /realtime
 */

import { realtimeSubscribe } from "#questpie/server/adapters/routes/realtime.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.post()
	.raw()
	.handler(async (ctx) => {
		const { request } = ctx;
		const app = routeApp(ctx);
		return realtimeSubscribe(app, request, {});
	});
