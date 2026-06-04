import { apiKey } from "@better-auth/api-key";
import { authConfig } from "questpie/app";

export default authConfig({
	plugins: [
		apiKey({
			enableSessionForAPIKeys: true,
			apiKeyHeaders: "x-api-key",
			schema: {
				apikey: {
					fields: {
						referenceId: "userId",
					},
				},
			},
		}),
	],
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: false,
	},
});
