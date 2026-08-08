import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/favicon.ico")({
	server: {
		handlers: {
			GET: ({ request }) =>
				Response.redirect(new URL("/favicon.svg", request.url), 308),
		},
	},
});
