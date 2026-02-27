import { createClient } from "questpie/client";
import type { AppConfig, AppRpc } from "@/questpie/server/app.js";

export const client = createClient<AppConfig, AppRpc>({
	baseURL:
		typeof window !== "undefined"
			? window.location.origin
			: process.env.APP_URL || "http://localhost:3000",
	basePath: "/api",
});

export type AppClient = typeof client;
