/**
 * API Routes - Catch-all handler
 *
 * Handles all API endpoints including OpenAPI spec + docs
 * (served via openApiModule registered in modules.ts).
 */

import { createFileRoute } from "@tanstack/react-router";
import { createFetchHandler } from "questpie";

import { app } from "#questpie";

const handler = createFetchHandler(app, {
	basePath: "/api",
});

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
