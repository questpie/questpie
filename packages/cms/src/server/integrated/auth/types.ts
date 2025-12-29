import type { BetterAuthOptions } from "better-auth";

/**
 * Configuration options for defaultQCMSAuth
 */
export type QCMSAuthConfig = {
	/**
	 * Enable email/password authentication
	 * @default true
	 */
	emailPassword?: boolean;

	/**
	 * Social providers configuration
	 * Provide client ID and secret for each provider you want to enable
	 */
	socialProviders?: {
		google?: {
			clientId: string;
			clientSecret: string;
		};
		github?: {
			clientId: string;
			clientSecret: string;
		};
		discord?: {
			clientId: string;
			clientSecret: string;
		};
	};

	/**
	 * Additional Better Auth plugins
	 * These will be added after default plugins (admin, apiKey, bearer)
	 */
	plugins?: BetterAuthOptions["plugins"];

	/**
	 * Require email verification for email/password signup
	 * @default true
	 */
	emailVerification?: boolean;

	/**
	 * Base URL for the auth service
	 * Used for OAuth redirects and email links
	 */
	baseURL?: string;

	/**
	 * Secret key for signing tokens
	 * Falls back to BETTER_AUTH_SECRET env variable
	 */
	secret?: string;
};
