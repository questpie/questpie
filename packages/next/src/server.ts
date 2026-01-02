import { createCMSFetchHandler, type CMSAdapterConfig, type QCMS } from "@questpie/cms/server";

export type NextAdapterConfig = CMSAdapterConfig;

type NextHandler = (request: Request) => Promise<Response>;

const notFoundResponse = () =>
	new Response(JSON.stringify({ error: "Not found" }), {
		status: 404,
		headers: {
			"Content-Type": "application/json",
		},
	});

/**
 * Create a Next.js-compatible handler for QUESTPIE CMS routes.
 */
export const questpieNext = (
	cms: QCMS<any>,
	config: NextAdapterConfig = {},
): NextHandler => {
	const handler = createCMSFetchHandler(cms, config);

	return async (request) => {
		const response = await handler(request);
		return response ?? notFoundResponse();
	};
};

/**
 * Convenience helpers for Next.js route handlers.
 */
export const questpieNextRouteHandlers = (
	cms: QCMS<any>,
	config: NextAdapterConfig = {},
): Record<string, NextHandler> => {
	const handler = questpieNext(cms, config);

	return {
		GET: handler,
		POST: handler,
		PATCH: handler,
		DELETE: handler,
		PUT: handler,
		OPTIONS: handler,
		HEAD: handler,
	};
};
