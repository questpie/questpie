/**
 * Client Configuration
 *
 * Type-safe client for accessing barbershop data
 */

import { createClient } from "questpie/client";

import type { AppConfig } from "#questpie";

import { getAppUrl } from "./app-url";

export const client = createClient<AppConfig>({
	baseURL: getAppUrl(),
	basePath: "/api",
});
