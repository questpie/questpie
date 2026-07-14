import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

/** Public provider metadata; secrets remain inside the server transport. */
export default route()
	.get()
	.access(true)
	.raw()
	.handler(async (ctx) => {
		const config = await routeApp(ctx).realtime?.getClientTransportConfig({
			request: ctx.request,
		});
		return Response.json(config ?? { transport: "sse" }, {
			headers: { "Cache-Control": "no-store" },
		});
	});
