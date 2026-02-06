/**
 * CMS Client Configuration
 *
 * Type-safe client for accessing barbershop CMS data
 */

import { createClient } from "questpie/client";
import type { AppCMS, AppRpc } from "@/questpie/server/cms";

export const client = createClient<AppCMS, AppRpc>({
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.APP_URL || "http://localhost:3000",
  basePath: "/api/cms",
});

export type CMSClient = typeof client;
