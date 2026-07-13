import { route } from "questpie/services";

import { handleFsPut, miniAppFsAccess, type FsContext } from "./_path";

export default route()
	.put()
	.access(miniAppFsAccess)
	.params<{ appId: string; path: string }>()
	.raw()
	.handler(async (ctx) => handleFsPut(ctx as FsContext));
