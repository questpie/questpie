/**
 * Client Configuration
 *
 * Type-safe client for accessing barbershop data
 */

import { createClient } from "questpie/client";
import type { AppConfig, AppFunctions } from "@/questpie/server/app";

export const client = createClient<AppConfig, AppFunctions>({
	baseURL:
		typeof window !== "undefined"
			? window.location.origin
			: process.env.APP_URL || "http://localhost:3000",
	basePath: "/api",
});

export type AppClient = typeof client;
