import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { createOwner } from "./data/questpie";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const owner = createOwner(import.meta.env.SSR);
	const router = createRouter({
		routeTree,
		context: { owner },
		dehydrate: () => ({ questpie: owner.dehydrate() }),
		hydrate: (state) => owner.hydrate(state.questpie),
	});
	setupRouterSsrQueryIntegration({ router, queryClient: owner.cache });
	const hydrate = router.options.hydrate!;
	router.options.hydrate = async (state) => {
		await hydrate(state);
		owner.hydrationSetupComplete();
	};
	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
