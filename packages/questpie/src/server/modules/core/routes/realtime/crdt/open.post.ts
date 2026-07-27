import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.post()
	.access(true)
	.raw()
	.handler((ctx) => routeApp(ctx).crdtOperations.handleOpen(ctx.request));
