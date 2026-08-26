import { defineService } from "questpie";

export const supportAuth = defineService({
	name: "teamSupport.auth",
	lifetime: "application",
	effect: "external",
	create: async () => {
		const { createSupportBetterAuth } =
			await import("../../runtime/better-auth");
		const infrastructure = await createSupportBetterAuth();
		return Object.freeze({
			handler: (request: Request) => infrastructure.auth.handler(request),
			principalId: async (headers: Headers): Promise<string | null> => {
				const session = await infrastructure.auth.api.getSession({ headers });
				return session?.user.id ?? null;
			},
			close: infrastructure.close,
		});
	},
	dispose: (auth) => auth.close(),
});
