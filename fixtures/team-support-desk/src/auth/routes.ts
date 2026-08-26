import { policy } from "questpie";

import { defineRoute } from "#questpie/app";

const route = (
	name: "support.authGet" | "support.authPost",
	method: "GET" | "POST",
) =>
	defineRoute({
		name,
		method,
		path: "/api/auth/*path",
		policy: policy.public(),
		credentials: "none",
		limits: { bodyBytes: 65_536, durationMs: 5_000 },
		handler: ({ request, ctx }) =>
			ctx.services["teamSupport.auth"].handler(request),
	});

export const betterAuthGet = route("support.authGet", "GET");
export const betterAuthPost = route("support.authPost", "POST");
