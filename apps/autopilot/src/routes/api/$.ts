import { createFileRoute } from "@tanstack/react-router";
import { createFetchHandler } from "questpie";

import { app } from "#questpie";

const handler = createFetchHandler(app, {
	basePath: "/api",
});

const handleRequest = async (request: Request) => {
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
			GET: ({ request }) => handleRequest(request),
			POST: ({ request }) => handleRequest(request),
			PUT: ({ request }) => handleRequest(request),
			DELETE: ({ request }) => handleRequest(request),
			PATCH: ({ request }) => handleRequest(request),
		},
	},
});
