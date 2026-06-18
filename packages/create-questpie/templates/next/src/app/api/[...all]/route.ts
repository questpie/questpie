import { createFetchHandler } from "questpie/http";

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

export const GET = handleCmsRequest;
export const POST = handleCmsRequest;
export const PUT = handleCmsRequest;
export const DELETE = handleCmsRequest;
export const PATCH = handleCmsRequest;
