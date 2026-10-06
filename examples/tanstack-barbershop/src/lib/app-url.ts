import { createIsomorphicFn } from "@tanstack/react-start";

import env from "@/questpie/server/env";

export const getAppUrl = createIsomorphicFn()
	.client(() => window.location.origin)
	.server(() => env.APP_URL);
