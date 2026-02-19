/**
 * Auth Client Configuration
 *
 * Type-safe Better Auth client for admin authentication
 */

import { createAdminAuthClient } from "@questpie/admin/client";
import type { App } from "@/questpie/server/app";

export const authClient = createAdminAuthClient<App>({
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.APP_URL || "http://localhost:3000",
  basePath: "/api/auth",
});

export type AuthClient = typeof authClient;
