import { createCMSFetchHandler, type CMSAdapterConfig, type QCMS } from "@questpie/cms/server";

export type TanStackStartAdapterConfig = CMSAdapterConfig;

export type TanStackStartHandlerContext = {
	request: Request;
};

const notFoundResponse = () =>
	new Response(JSON.stringify({ error: "Not found" }), {
		status: 404,
		headers: {
			"Content-Type": "application/json",
		},
	});

/**
 * Create TanStack Start server handlers for QUESTPIE CMS routes.
 */
export const questpieStartHandlers = (
	cms: QCMS<any>,
	config: TanStackStartAdapterConfig = {},
): Record<string, (ctx: TanStackStartHandlerContext) => Promise<Response>> => {
	const handler = createCMSFetchHandler(cms, config);

	const handle = async ({ request }: TanStackStartHandlerContext) => {
		const response = await handler(request);
		return response ?? notFoundResponse();
	};

	return {
		GET: handle,
		POST: handle,
		PATCH: handle,
		DELETE: handle,
		PUT: handle,
		OPTIONS: handle,
		HEAD: handle,
	};
};
