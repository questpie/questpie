import { admin, bearer } from "better-auth/plugins";
import { authConfig } from "questpie/app";

export default authConfig({
	plugins: [admin(), bearer()],
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: false,
	},
});
