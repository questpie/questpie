import type { BetterAuthOptions } from "better-auth";
import { createAuthClient } from "better-auth/client";

import type { AppConfig } from "@/questpie/server/app.js";

/**
 * Type-safe Better Auth client (vanilla, no React).
 *
 * `signIn`, `signUp`, `signOut`, `getSession`, etc. are fully typed from the
 * app's auth configuration via `AppConfig["auth"]`. This headless template
 * ships the framework-agnostic `better-auth/client` so a separate frontend or
 * scripts can consume it.
 */
type AppAuthOptions = AppConfig["auth"] extends BetterAuthOptions
	? AppConfig["auth"]
	: BetterAuthOptions;

type AuthClientOptions = {
	baseURL: string;
	fetchOptions?: { credentials?: RequestCredentials };
	$InferAuth: AppAuthOptions;
};

export const authClient = createAuthClient<AuthClientOptions>({
	baseURL:
		typeof window !== "undefined"
			? `${window.location.origin}/api/auth`
			: `${process.env.APP_URL || "http://localhost:3000"}/api/auth`,
	fetchOptions: { credentials: "include" },
} as AuthClientOptions);

export type AuthClient = typeof authClient;
