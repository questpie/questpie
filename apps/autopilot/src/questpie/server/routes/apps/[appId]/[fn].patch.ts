import { route } from "questpie/services";

import {
	handleMiniAppEndpoint,
	miniAppActionAccess,
	type AppRouteContext,
} from "./_fn";

export default route()
	.patch()
	.access(miniAppActionAccess)
	.params<{ appId: string; fn: string }>()
	.raw()
	.handler(async (ctx) => handleMiniAppEndpoint(ctx as AppRouteContext));
