import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/favicon.ico")({
	server: {
		handlers: {
			GET: () =>
				new Response(null, {
					status: 308,
					headers: { Location: "/favicon.svg" },
				}),
		},
	},
});
