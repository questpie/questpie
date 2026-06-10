/**
 * Auth Client Configuration
 *
 * Type-safe Better Auth client for admin authentication
 */

import type { AppConfig } from "#questpie";
import { env } from "#questpie/env.client.vite";
import { createAdminAuthClient } from "@questpie/admin/client";

export const authClient = createAdminAuthClient<AppConfig>({
	baseURL: typeof window !== "undefined" ? window.location.origin : env.APP_URL,
	basePath: "/api/auth",
});
