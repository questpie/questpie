/**
 * Client Configuration
 *
 * Type-safe client for accessing barbershop data
 */

import { createClient } from "questpie/client";

import type { AppConfig } from "#questpie";
import { env } from "#questpie/env.client.vite";

export const client = createClient<AppConfig>({
	baseURL: typeof window !== "undefined" ? window.location.origin : env.APP_URL,
	basePath: "/api",
});
