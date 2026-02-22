/**
 * API Routes - Catch-all handler
 *
 * Handles all API endpoints for the City Portal.
 */

import { withOpenApi } from "@questpie/openapi";
import { createFileRoute } from "@tanstack/react-router";
import { createFetchHandler } from "questpie";
import { app, appRpc } from "@/questpie/server/app";

const handler = withOpenApi(
	createFetchHandler(app, {
		basePath: "/api",
		rpc: appRpc,
	}),
	{
		app,
		rpc: appRpc,
		basePath: "/api",
		info: {
			title: "City Portal API",
			version: "1.0.0",
			description: "QUESTPIE API for the City Portal example",
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

export const Route = createFileRoute("/api/$")({
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
