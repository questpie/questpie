/**
 * Realtime SSE route — multiplexed realtime subscriptions.
 *
 * POST /realtime
 */

import { createRealtimeRoutes } from "#questpie/server/adapters/routes/realtime.js";
import { route } from "#questpie/server/routes/define-route.js";

export default route()
	.post()
	.raw()
	.handler(async ({ app, request }) => {
		const routes = createRealtimeRoutes(app);
		return routes.subscribe(request, {});
	});
