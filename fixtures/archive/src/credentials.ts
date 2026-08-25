import { defineCredentialResolver, defineService, principal } from "questpie";

const principalHeader = "x-questpie-archive-principal";

export const archiveCredentials = defineService({
	name: "archive.credentials",
	lifetime: "application",
	effect: "external",
	create: () =>
		Object.freeze({
			resolve(request: Request) {
				const id = request.headers.get(principalHeader);
				return id === null ? null : principal.user({ id });
			},
		}),
});

export const applicationCredentials = defineCredentialResolver({
	name: "archive.application-credentials",
	service: archiveCredentials,
	resolve: ({ request, service }) => {
		const resolved = service.resolve(request);
		return resolved === null
			? { kind: "anonymous" as const }
			: { kind: "resolved" as const, principal: resolved };
	},
});
