/**
 * Auth Client Configuration
 *
 * Type-safe Better Auth client for admin authentication
 */

import type { AppConfig } from "#questpie";
import { createAdminAuthClient } from "@questpie/admin/client";

import { getAppUrl } from "./app-url";

export const authClient = createAdminAuthClient<AppConfig>({
	baseURL: getAppUrl(),
	basePath: "/api/auth",
});
