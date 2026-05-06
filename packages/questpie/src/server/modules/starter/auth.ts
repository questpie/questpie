import { admin, bearer } from "better-auth/plugins";

import { auth } from "#questpie/server/modules/core/integrated/auth/merge.js";

auth({
	plugins: [admin(), bearer()],
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
	},
});
