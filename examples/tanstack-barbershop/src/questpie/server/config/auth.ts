/**
 * Barbershop Auth Configuration
 *
 * Better Auth settings for the barbershop app.
 */
import { authConfig } from "questpie";

export default authConfig({
	emailAndPassword: { enabled: true, requireEmailVerification: false },
	baseURL: process.env.APP_URL || "http://localhost:3000",
	basePath: "/api/auth",
	secret: process.env.BETTER_AUTH_SECRET || "demo-secret-change-in-production",
});
