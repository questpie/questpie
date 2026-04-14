/**
 * Client Configuration
 *
 * Type-safe client for accessing barbershop data
 */

import { createClient } from "questpie/client";

import type { AppConfig } from "#questpie";

export const client = createClient<AppConfig>({
	baseURL:
		typeof window !== "undefined"
			? window.location.origin
			: process.env.APP_URL || "http://localhost:3000",
	basePath: "/api",
});
