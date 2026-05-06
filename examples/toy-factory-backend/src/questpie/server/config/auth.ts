import { authConfig } from "questpie";

export default authConfig({
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: false,
	},
});
