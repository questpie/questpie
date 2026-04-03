/**
 * Barbershop Auth Configuration
 *
 * Better Auth settings for the barbershop app.
 * Runtime values (secret, baseURL) come from runtimeConfig / env vars.
 */
import { authConfig } from "questpie";

export default authConfig({
	emailAndPassword: { enabled: true, requireEmailVerification: false },
});
