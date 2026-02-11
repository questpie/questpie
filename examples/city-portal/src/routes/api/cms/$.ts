/**
 * CMS API Routes - Catch-all handler
 *
 * Handles all CMS endpoints for the City Portal.
 */

import { withOpenApi } from "@questpie/openapi";
import { createFileRoute } from "@tanstack/react-router";
import { createFetchHandler } from "questpie";
import { appRpc, cms } from "@/questpie/server/cms";

const handler = withOpenApi(
	createFetchHandler(cms, {
		basePath: "/api/cms",
		rpc: appRpc,
	}),
	{
		cms,
		rpc: appRpc,
		basePath: "/api/cms",
		info: {
			title: "City Portal API",
			version: "1.0.0",
			description: "QuestPie CMS API for the City Portal example",
		},
		scalar: { theme: "blue" },
	},
);

const handleCmsRequest = async (request: Request) => {
	const response = await handler(request);
	return (
		response ??
		new Response(JSON.stringify({ error: "Not found" }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		})
	);
};

export const Route = createFileRoute("/api/cms/$")({
	server: {
		handlers: {
			GET: ({ request }) => handleCmsRequest(request),
			POST: ({ request }) => handleCmsRequest(request),
			PUT: ({ request }) => handleCmsRequest(request),
			DELETE: ({ request }) => handleCmsRequest(request),
			PATCH: ({ request }) => handleCmsRequest(request),
		},
	},
});
