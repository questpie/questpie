import type { AppConfig } from "@/questpie/server/app.js";
import { createAdminAuthClient } from "@questpie/admin/client";

export const authClient = createAdminAuthClient<AppConfig>({
	baseURL:
		typeof window !== "undefined"
			? window.location.origin
			: process.env.APP_URL || "http://localhost:3000",
	basePath: "/api/auth",
});

export type AuthClient = typeof authClient;
