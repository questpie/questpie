import { admin, bearer } from "better-auth/plugins";

import { auth } from "#questpie/server/integrated/auth/merge.js";

auth({
	baseURL: process.env.BETTER_AUTH_URL,
	secret: process.env.BETTER_AUTH_SECRET,
	advanced: {
		useSecureCookies: process.env.NODE_ENV === "production",
	},
	plugins: [admin(), bearer()],
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
	},
});
