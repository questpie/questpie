import { createClient } from "questpie/client";
import type { App, AppRpc } from "@/questpie/server/app.js";

export const client = createClient<App, AppRpc>({
	baseURL:
		typeof window !== "undefined"
			? window.location.origin
			: process.env.APP_URL || "http://localhost:3000",
	basePath: "/api",
});

export type AppClient = typeof client;
