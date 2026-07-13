import { route } from "questpie/services";

import { handleFsGet, miniAppFsAccess, type FsContext } from "./_path";

export default route()
	.get()
	.access(miniAppFsAccess)
	.params<{ appId: string; path: string }>()
	.raw()
	.handler(async (ctx) => {
		const c = ctx as FsContext;
		return handleFsGet(c, new URL(c.request.url));
	});
