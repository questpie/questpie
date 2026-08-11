import {
	APIError,
	type BetterAuthOptions,
	type BetterAuthPlugin,
} from "better-auth";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { lastLoginMethod } from "better-auth/plugins";
import {
	github,
	google,
	type GithubOptions,
	type GoogleOptions,
} from "better-auth/social-providers";

import { mergeAuthOptions } from "./merge.js";

export type PublicAuthEntryMethod =
	| { id: "email"; kind: "credentials" }
	| { id: "google" | "github"; kind: "social" };

type ProviderCredentialPair = {
	clientId: string;
	clientSecret: string;
};

type GoogleAuthEntryOptions = Omit<
	GoogleOptions,
	"clientId" | "clientSecret" | "getUserInfo" | "verifyIdToken"
> &
	ProviderCredentialPair;

type GithubAuthEntryOptions = Omit<
	GithubOptions,
	"clientId" | "clientSecret" | "getUserInfo"
> &
	ProviderCredentialPair;

type ReviewedNonEntryPlugin = BetterAuthPlugin & {
	id: "admin" | "bearer" | "jwt" | "oauth-provider" | "open-api";
};

export type AuthEntryMethodsInput = {
	authOptions?: Omit<BetterAuthOptions, "plugins" | "socialProviders"> & {
		plugins?: ReviewedNonEntryPlugin[];
		socialProviders?: never;
	};
	credentials: { enabled: boolean };
	socialProviders?: {
		google?: GoogleAuthEntryOptions;
		github?: GithubAuthEntryOptions;
	};
	requireVerifiedProviderEmail: true;
	lastLoginMethod?: {
		enabledWhenMultiple: true;
		storeInDatabase: false;
		maxAgeSeconds?: number;
	};
};

export type AuthEntryMethodsConfig = {
	authOptions: BetterAuthOptions;
	publicMethods: readonly PublicAuthEntryMethod[];
};

const SOCIAL_PROVIDER_ERROR_CODE = "social_provider_error";
const SOCIAL_PROVIDER_ERROR_MESSAGE = "Social provider authentication failed";
const SOCIAL_PROVIDER_ERROR_MARKER = "questpie_social_provider_error";
const REVIEWED_NON_ENTRY_PLUGIN_IDS = new Set([
	"admin",
	"bearer",
	"jwt",
	"oauth-provider",
	"open-api",
]);
const SECURITY_SENSITIVE_PROVIDER_OPTIONS = {
	google: ["getUserInfo", "verifyIdToken"],
	github: ["getUserInfo"],
} as const;

function hasProviderError(params: URLSearchParams): boolean {
	return params.has("error") || params.has("error_description");
}

function sanitizeProviderError(params: URLSearchParams): void {
	params.set("error", SOCIAL_PROVIDER_ERROR_CODE);
	params.delete("error_description");
}

function markProviderErrorCallbackURL(
	callbackURL: unknown,
	configuredErrorURL: unknown,
	baseURL: string,
): string {
	const raw =
		typeof callbackURL === "string" && callbackURL.length > 0
			? callbackURL
			: typeof configuredErrorURL === "string" && configuredErrorURL.length > 0
				? configuredErrorURL
				: `${baseURL}/error`;
	const absolute = /^[a-z][a-z\d+.-]*:/i.test(raw);
	const url = new URL(raw, baseURL);
	url.searchParams.set(SOCIAL_PROVIDER_ERROR_MARKER, "1");
	return absolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
}

function createSocialProviderErrorBoundary(
	providerIds: readonly ("google" | "github")[],
): BetterAuthPlugin {
	const enabledProviders = new Set(providerIds);
	return {
		id: "questpie-auth-entry-methods",
		async onRequest(request, context) {
			const url = new URL(request.url);
			const providerSegment = url.pathname.match(
				/\/callback\/([^/]+)\/?$/,
			)?.[1];
			let providerId: string | undefined;
			try {
				providerId = providerSegment
					? decodeURIComponent(providerSegment)
					: undefined;
			} catch {
				return;
			}
			if (
				(providerId !== "google" && providerId !== "github") ||
				!enabledProviders.has(providerId)
			) {
				return;
			}

			const queryChanged = hasProviderError(url.searchParams);
			if (queryChanged) {
				context.logger.warn("Social provider callback rejected", {
					providerId,
					error: url.searchParams.get("error"),
					errorDescription: url.searchParams.get("error_description"),
				});
				sanitizeProviderError(url.searchParams);
			}
			if (request.method === "GET") {
				return queryChanged
					? { request: new Request(url, request) }
					: undefined;
			}
			if (request.method !== "POST") return;

			const contentType = request.headers.get("content-type") ?? "";
			if (contentType.includes("application/x-www-form-urlencoded")) {
				const body = new URLSearchParams(await request.clone().text());
				const bodyChanged = hasProviderError(body);
				if (bodyChanged) sanitizeProviderError(body);
				if (!queryChanged && !bodyChanged) return;
				const headers = new Headers(request.headers);
				headers.delete("content-length");
				return {
					request: new Request(url, {
						method: "POST",
						headers,
						body,
					}),
				};
			}
			if (!contentType.includes("application/json")) {
				return queryChanged
					? { request: new Request(url, request) }
					: undefined;
			}

			const body = await request
				.clone()
				.json()
				.catch(() => null);
			if (!body || typeof body !== "object" || Array.isArray(body)) {
				return queryChanged
					? { request: new Request(url, request) }
					: undefined;
			}
			const record = body as Record<string, unknown>;
			const bodyChanged = "error" in record || "error_description" in record;
			if (bodyChanged) {
				record.error = SOCIAL_PROVIDER_ERROR_CODE;
				delete record.error_description;
			}
			if (!queryChanged && !bodyChanged) return;
			const headers = new Headers(request.headers);
			headers.delete("content-length");
			return {
				request: new Request(url, {
					method: "POST",
					headers,
					body: JSON.stringify(record),
				}),
			};
		},
		hooks: {
			before: [
				{
					matcher: (context) =>
						context.path === "/sign-in/social" ||
						context.path === "/link-social",
					handler: createAuthMiddleware(async (context) => {
						const body = context.body as Record<string, unknown> | undefined;
						if (!body) return;
						const providerId = body.provider;
						if (
							(providerId !== "google" && providerId !== "github") ||
							!enabledProviders.has(providerId)
						) {
							return;
						}
						body.errorCallbackURL = markProviderErrorCallbackURL(
							body.errorCallbackURL,
							context.context.options.onAPIError?.errorURL,
							context.context.baseURL,
						);
					}),
				},
			],
			after: [
				{
					matcher: (context) => context.path === "/sign-in/social",
					handler: createAuthMiddleware(async (context) => {
						if (!isAPIError(context.context.returned)) return;
						throw new APIError("UNAUTHORIZED", {
							code: SOCIAL_PROVIDER_ERROR_CODE,
							message: SOCIAL_PROVIDER_ERROR_MESSAGE,
						});
					}),
				},
				{
					matcher: (context) => context.path === "/callback/:id",
					handler: createAuthMiddleware(async (context) => {
						const location = context.context.responseHeaders?.get("location");
						if (!location) return;
						const absolute = /^[a-z][a-z\d+.-]*:/i.test(location);
						const redirect = new URL(location, context.context.baseURL);
						if (
							redirect.searchParams.get(SOCIAL_PROVIDER_ERROR_MARKER) !== "1"
						) {
							return;
						}
						redirect.searchParams.delete(SOCIAL_PROVIDER_ERROR_MARKER);
						sanitizeProviderError(redirect.searchParams);
						context.setHeader(
							"location",
							absolute
								? redirect.toString()
								: `${redirect.pathname}${redirect.search}${redirect.hash}`,
						);
					}),
				},
			],
		},
	};
}

function assertProviderCredentials(
	providerId: "google" | "github",
	options: Partial<ProviderCredentialPair>,
): asserts options is ProviderCredentialPair {
	if (
		typeof options.clientId !== "string" ||
		options.clientId.trim().length === 0 ||
		typeof options.clientSecret !== "string" ||
		options.clientSecret.trim().length === 0
	) {
		throw new TypeError(
			`Auth entry provider "${providerId}" requires non-empty clientId and clientSecret values`,
		);
	}
}

function assertNoProviderSecurityOverrides(
	providerId: "google" | "github",
	options: object,
): void {
	for (const option of SECURITY_SENSITIVE_PROVIDER_OPTIONS[providerId]) {
		if (option in options) {
			throw new TypeError(
				`Auth entry provider "${providerId}" does not allow the "${option}" override`,
			);
		}
	}
}

function assertNoBypassEntryMethods(
	authOptions: AuthEntryMethodsInput["authOptions"],
): void {
	const runtimeOptions = authOptions as BetterAuthOptions | undefined;
	if (Object.keys(runtimeOptions?.socialProviders ?? {}).length > 0) {
		throw new TypeError(
			"Auth entry social providers must be configured through socialProviders",
		);
	}
	const unsupportedPlugin = runtimeOptions?.plugins?.find(
		(plugin) => !REVIEWED_NON_ENTRY_PLUGIN_IDS.has(plugin.id),
	);
	if (unsupportedPlugin) {
		throw new TypeError(
			`Auth entry plugin "${unsupportedPlugin.id}" is not in the reviewed non-entry allowlist`,
		);
	}
}

function withVerifiedGoogleEmail(
	options: GoogleAuthEntryOptions,
): GoogleOptions {
	const { mapProfileToUser, ...providerOptions } = options;
	const provider = google(providerOptions);
	return {
		...options,
		getUserInfo: async (tokens) => {
			const result = await provider.getUserInfo(tokens);
			const providerId: unknown = result?.user.id;
			if (
				!result ||
				result.user.emailVerified !== true ||
				(typeof providerId !== "string" && typeof providerId !== "number") ||
				(typeof providerId === "number" && !Number.isFinite(providerId)) ||
				String(providerId).trim().length === 0 ||
				typeof result.user.email !== "string" ||
				result.user.email.trim().length === 0
			) {
				return null;
			}
			const mapped = await mapProfileToUser?.(result.data);
			return {
				data: result.data,
				user: {
					...result.user,
					...mapped,
					id: String(providerId).trim(),
					email: result.user.email.trim(),
					emailVerified: true,
				},
			};
		},
	};
}

function withVerifiedGithubEmail(
	options: GithubAuthEntryOptions,
): GithubOptions {
	const { mapProfileToUser, ...providerOptions } = options;
	const provider = github(providerOptions);
	return {
		...options,
		getUserInfo: async (tokens) => {
			const result = await provider.getUserInfo(tokens);
			const providerId: unknown = result?.user.id;
			if (
				!result ||
				result.user.emailVerified !== true ||
				(typeof providerId !== "string" && typeof providerId !== "number") ||
				(typeof providerId === "number" && !Number.isFinite(providerId)) ||
				String(providerId).trim().length === 0 ||
				typeof result.user.email !== "string" ||
				result.user.email.trim().length === 0
			) {
				return null;
			}
			const mapped = await mapProfileToUser?.(result.data);
			return {
				data: result.data,
				user: {
					...result.user,
					...mapped,
					id: String(providerId).trim(),
					email: result.user.email.trim(),
					emailVerified: true,
				},
			};
		},
	};
}

export function configureAuthEntryMethods(
	input: AuthEntryMethodsInput,
): AuthEntryMethodsConfig {
	assertNoBypassEntryMethods(input.authOptions);
	if (input.socialProviders?.google) {
		assertProviderCredentials("google", input.socialProviders.google);
		assertNoProviderSecurityOverrides("google", input.socialProviders.google);
	}
	if (input.socialProviders?.github) {
		assertProviderCredentials("github", input.socialProviders.github);
		assertNoProviderSecurityOverrides("github", input.socialProviders.github);
	}

	const publicMethods: PublicAuthEntryMethod[] = [];
	if (input.credentials.enabled) {
		publicMethods.push({ id: "email", kind: "credentials" });
	}
	if (input.socialProviders?.google) {
		publicMethods.push({ id: "google", kind: "social" });
	}
	if (input.socialProviders?.github) {
		publicMethods.push({ id: "github", kind: "social" });
	}

	const plugins: BetterAuthPlugin[] = [];
	const socialMethodIds = publicMethods
		.filter(
			(method): method is Extract<PublicAuthEntryMethod, { kind: "social" }> =>
				method.kind === "social",
		)
		.map(({ id }) => id);
	if (socialMethodIds.length > 0) {
		plugins.push(createSocialProviderErrorBoundary(socialMethodIds));
	}
	if (input.lastLoginMethod?.enabledWhenMultiple && publicMethods.length >= 2) {
		plugins.push(
			lastLoginMethod({
				storeInDatabase: false,
				...(input.lastLoginMethod.maxAgeSeconds === undefined
					? {}
					: { maxAge: input.lastLoginMethod.maxAgeSeconds }),
			}),
		);
	}

	const protectedOptions: BetterAuthOptions = {
		emailAndPassword: { enabled: input.credentials.enabled },
		account: {
			accountLinking: {
				disableImplicitLinking: true,
			},
		},
		socialProviders: input.socialProviders
			? {
					...(input.socialProviders.google
						? {
								google: withVerifiedGoogleEmail(input.socialProviders.google),
							}
						: {}),
					...(input.socialProviders.github
						? {
								github: withVerifiedGithubEmail(input.socialProviders.github),
							}
						: {}),
				}
			: undefined,
		plugins: plugins.length > 0 ? plugins : undefined,
	};

	return {
		authOptions: mergeAuthOptions(input.authOptions ?? {}, protectedOptions),
		publicMethods,
	};
}
