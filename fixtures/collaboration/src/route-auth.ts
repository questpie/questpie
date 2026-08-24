import {
	defineCredentialResolver,
	defineService,
	policy,
	principal,
} from "questpie";

import { defineRoute } from "#questpie/app";

import { tracerIds } from "../tracer/constants";

export const demoSessionCookieName = "questpie_tracer_session";
export const demoSessionToken = "f18f8b8e0e1446079dc6e6d4755505f9";

function hasDemoSession(headers: Headers): boolean {
	const cookie = headers.get("cookie");
	if (cookie === null) return false;

	let matches = 0;
	for (const rawPair of cookie.split(";")) {
		const pair = rawPair.trim();
		const separator = pair.indexOf("=");
		if (separator <= 0) return false;
		const name = pair.slice(0, separator).trim();
		const value = pair.slice(separator + 1).trim();
		if (name !== demoSessionCookieName) continue;
		if (value !== demoSessionToken || matches > 0) return false;
		matches += 1;
	}

	return matches === 1;
}

export const demoAuth = defineService({
	name: "collaboration.demo-auth",
	lifetime: "application",
	effect: "external",
	create: () => Object.freeze({ hasDemoSession }),
});

export const applicationCredentials = defineCredentialResolver({
	name: "collaboration.credentials",
	service: demoAuth,
	resolve: ({ request, service }) =>
		service.hasDemoSession(request.headers)
			? {
					kind: "resolved",
					principal: principal.user({ id: tracerIds.principal }),
				}
			: { kind: "anonymous" },
});

export const whoami = defineRoute({
	name: "collaboration.whoami",
	method: "GET",
	path: "/api/whoami",
	policy: policy.authenticated(),
	credentials: "application",
	limits: { bodyBytes: 0, durationMs: 1_000 },
	handler: ({ ctx }) =>
		Response.json(
			{ principal: { kind: ctx.principal.kind, id: ctx.principal.id } },
			{ headers: { "cache-control": "no-store", vary: "Cookie" } },
		),
});
