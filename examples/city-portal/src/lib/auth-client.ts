/**
 * Auth Client Configuration
 *
 * Type-safe Better Auth client for admin authentication
 */

import type { AppConfig } from "@/questpie/server/.generated";
import { createAdminAuthClient } from "@questpie/admin/client";

export const authClient = createAdminAuthClient<AppConfig>({
	baseURL:
		typeof window !== "undefined"
			? window.location.origin
			: process.env.APP_URL || "http://localhost:3000",
	basePath: "/api/auth",
});

export type AuthClient = typeof authClient;
