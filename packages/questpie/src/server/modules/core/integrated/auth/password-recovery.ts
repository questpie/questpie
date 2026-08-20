import { createHash, randomBytes } from "node:crypto";

import type { BetterAuthPlugin, DBTransactionAdapter } from "better-auth";
import { APIError } from "better-auth/api";
import { createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { z } from "zod";

import type { AuthTransactionalQueuePublish } from "./transactional-queue.js";
import { withAuthTransactionalQueue } from "./transactional-queue.js";

const REQUEST_STATE_COOKIE = "password_recovery_request";
const CHALLENGE_COOKIE = "password_recovery_challenge";
const RESET_PREFIX = "questpie-password-recovery:reset:";
const CHALLENGE_PREFIX = "questpie-password-recovery:challenge:";
const REQUEST_PREFIX = "questpie-password-recovery:request:";

type AuthUser = {
	id: string;
	email: string;
	name: string;
	emailVerified: boolean;
} & Record<string, unknown>;

export interface PasswordRecoveryDispatchContext {
	publish: AuthTransactionalQueuePublish;
}

export interface PasswordRecoveryOptions<TUser extends AuthUser = AuthUser> {
	resetPath?: string;
	resetTokenTtlSeconds?: number;
	challengeTtlSeconds?: number;
	resendCooldownSeconds?: number;
	deliverResetLink: (
		input: {
			user: TUser | null;
			exchangeUrl: string | null;
			idempotencyKey: string;
		},
		context: PasswordRecoveryDispatchContext,
	) => Promise<void>;
	/**
	 * Validate and optionally normalize the candidate before hashing. When set,
	 * this callback owns the complete password policy; when omitted, Better
	 * Auth's configured minimum and maximum are enforced.
	 */
	preparePassword?: (input: {
		password: string;
		user: TUser;
	}) => Promise<string>;
	notifyResetCommitted: (
		input: {
			user: TUser;
			occurredAt: Date;
			idempotencyKey: string;
		},
		context: PasswordRecoveryDispatchContext,
	) => Promise<void>;
}

type VerificationRow = {
	identifier: string;
	value: string;
	expiresAt: Date;
};

type AccountRow = { id: string; userId: string; providerId: string };

type RequestState = {
	email: string;
	maskedEmail: string;
	retryAt: string;
};

const token = () => randomBytes(32).toString("base64url");
const digest = (value: string) =>
	createHash("sha256").update(value).digest("base64url");
const identifier = (prefix: string, value: string) =>
	`${prefix}${digest(value)}`;

function maskEmail(email: string): string {
	const separator = email.lastIndexOf("@");
	if (separator < 1) return "•••";
	const local = email.slice(0, separator);
	const domain = email.slice(separator + 1);
	return `${local.slice(0, Math.min(2, local.length))}•••@${domain}`;
}

function expiry(seconds: number): Date {
	return new Date(Date.now() + seconds * 1_000);
}

async function createVerification(
	auth: DBTransactionAdapter,
	data: VerificationRow,
): Promise<void> {
	await auth.create({ model: "verification", data });
}

async function findCredentialIdentity(
	auth: DBTransactionAdapter,
	email: string,
): Promise<AuthUser | null> {
	const user = await auth.findOne<AuthUser>({
		model: "user",
		where: [{ field: "email", value: email }],
	});
	const account = await auth.findOne<AccountRow>({
		model: "account",
		where: [
			{ field: "userId", value: user?.id ?? digest(email) },
			{ field: "providerId", value: "credential" },
		],
	});
	return user?.emailVerified && account ? user : null;
}

/**
 * Add token-free, transaction-safe password recovery to a Better Auth instance.
 *
 * Reset tokens and browser challenge handles are hashed before persistence. The
 * credential write, session/trusted-device revocation and durable notification
 * publication share one adapter transaction.
 */
export function passwordRecovery<TUser extends AuthUser = AuthUser>(
	options: PasswordRecoveryOptions<TUser>,
): BetterAuthPlugin {
	const resetPath = options.resetPath ?? "/reset-password";
	const resetTtl = options.resetTokenTtlSeconds ?? 3_600;
	const challengeTtl = options.challengeTtlSeconds ?? 900;
	const cooldown = options.resendCooldownSeconds ?? 60;
	const issueResetLink = async (input: {
		auth: DBTransactionAdapter;
		publish: AuthTransactionalQueuePublish;
		email: string;
		baseURL: string;
		hashForTiming: (value: string) => Promise<string>;
	}) => {
		const resetToken = token();
		await input.hashForTiming(resetToken);
		const user = await findCredentialIdentity(input.auth, input.email);
		await createVerification(input.auth, {
			identifier: identifier(RESET_PREFIX, resetToken),
			value: user?.id ?? `unavailable:${digest(resetToken)}`,
			expiresAt: expiry(resetTtl),
		});
		const idempotencyKey = `password-recovery-link:${digest(resetToken)}`;
		await options.deliverResetLink(
			{
				user: user ? (user as TUser) : null,
				exchangeUrl: user
					? `${input.baseURL}/password-recovery/exchange?token=${encodeURIComponent(resetToken)}`
					: null,
				idempotencyKey,
			},
			{ publish: input.publish },
		);
	};

	const request = createAuthEndpoint(
		"/password-recovery/request",
		{
			method: "POST",
			body: z.object({ email: z.email() }),
		},
		async (ctx) => {
			const email = ctx.body.email.toLowerCase();
			const stateHandle = token();
			const retryAt = new Date(Date.now() + cooldown * 1_000);
			await withAuthTransactionalQueue(ctx, async ({ auth, publish }) => {
				await issueResetLink({
					auth,
					publish,
					email,
					baseURL: ctx.context.baseURL,
					hashForTiming: (value) => ctx.context.password.hash(value),
				});
				await createVerification(auth, {
					identifier: identifier(REQUEST_PREFIX, stateHandle),
					value: JSON.stringify({
						email,
						maskedEmail: maskEmail(email),
						retryAt: retryAt.toISOString(),
					}),
					expiresAt: expiry(Math.max(resetTtl, cooldown)),
				});
			});
			const stateCookie = ctx.context.createAuthCookie(REQUEST_STATE_COOKIE, {
				httpOnly: true,
				sameSite: "lax",
				path: "/",
				maxAge: Math.max(resetTtl, cooldown),
			});
			await ctx.setSignedCookie(
				stateCookie.name,
				stateHandle,
				ctx.context.secret,
				stateCookie.attributes,
			);
			return ctx.json({ status: true });
		},
	);

	const requestState = createAuthEndpoint(
		"/password-recovery/request-state",
		{ method: "GET" },
		async (ctx) => {
			const stateCookie = ctx.context.createAuthCookie(REQUEST_STATE_COOKIE);
			const handle = await ctx.getSignedCookie(
				stateCookie.name,
				ctx.context.secret,
			);
			if (!handle) return ctx.json({ status: "missing" as const });
			const row = await ctx.context.adapter.findOne<VerificationRow>({
				model: "verification",
				where: [
					{ field: "identifier", value: identifier(REQUEST_PREFIX, handle) },
				],
			});
			if (!row || new Date(row.expiresAt) <= new Date()) {
				ctx.setCookie(stateCookie.name, "", {
					...stateCookie.attributes,
					maxAge: 0,
				});
				return ctx.json({ status: "missing" as const });
			}
			const state = JSON.parse(row.value) as RequestState;
			return ctx.json({
				status: "ready" as const,
				maskedEmail: state.maskedEmail,
				retryAt: state.retryAt,
			});
		},
	);

	const resend = createAuthEndpoint(
		"/password-recovery/resend",
		{ method: "POST" },
		async (ctx) => {
			const stateCookie = ctx.context.createAuthCookie(REQUEST_STATE_COOKIE);
			const handle = await ctx.getSignedCookie(
				stateCookie.name,
				ctx.context.secret,
			);
			if (!handle)
				throw APIError.from("BAD_REQUEST", {
					code: "PASSWORD_RECOVERY_REQUEST_MISSING",
					message: "Password recovery request is missing",
				});
			const nextRetryAt = new Date(Date.now() + cooldown * 1_000);
			const outcome = await withAuthTransactionalQueue(
				ctx,
				async ({ auth, publish }) => {
					const stateRow = await auth.consumeOne<VerificationRow>({
						model: "verification",
						where: [
							{
								field: "identifier",
								value: identifier(REQUEST_PREFIX, handle),
							},
							{ field: "expiresAt", operator: "gt", value: new Date() },
						],
					});
					if (!stateRow) return { status: "missing" as const };
					const state = JSON.parse(stateRow.value) as RequestState;
					if (new Date(state.retryAt) > new Date()) {
						await createVerification(auth, {
							identifier: stateRow.identifier,
							value: stateRow.value,
							expiresAt: stateRow.expiresAt,
						});
						return { status: "cooldown" as const, retryAt: state.retryAt };
					}
					await issueResetLink({
						auth,
						publish,
						email: state.email,
						baseURL: ctx.context.baseURL,
						hashForTiming: (value) => ctx.context.password.hash(value),
					});
					await createVerification(auth, {
						identifier: stateRow.identifier,
						value: JSON.stringify({
							...state,
							retryAt: nextRetryAt.toISOString(),
						}),
						expiresAt: stateRow.expiresAt,
					});
					return {
						status: "ready" as const,
						retryAt: nextRetryAt.toISOString(),
					};
				},
			);
			if (outcome.status === "missing")
				throw APIError.from("BAD_REQUEST", {
					code: "PASSWORD_RECOVERY_REQUEST_MISSING",
					message: "Password recovery request is missing",
				});
			if (outcome.status === "cooldown") {
				return new Response(
					JSON.stringify({
						status: "cooldown" as const,
						retryAt: outcome.retryAt,
					}),
					{
						status: 429,
						headers: {
							"cache-control": "no-store",
							"content-type": "application/json; charset=utf-8",
						},
					},
				);
			}
			return ctx.json({ status: true, retryAt: outcome.retryAt });
		},
	);

	const exchange = createAuthEndpoint(
		"/password-recovery/exchange",
		{ method: "GET", query: z.object({ token: z.string().optional() }) },
		async (ctx) => {
			if (
				!ctx.query.token ||
				ctx.query.token.length < 32 ||
				ctx.query.token.length > 128
			) {
				ctx.setHeader("cache-control", "no-store");
				ctx.setHeader("referrer-policy", "no-referrer");
				throw ctx.redirect("/forgot-password?reason=invalid");
			}
			const resetToken = ctx.query.token;
			const challenge = token();
			const exchanged = await ctx.context.adapter.transaction(async (auth) => {
				const reset = await auth.consumeOne<VerificationRow>({
					model: "verification",
					where: [
						{
							field: "identifier",
							value: identifier(RESET_PREFIX, resetToken),
						},
						{ field: "expiresAt", operator: "gt", value: new Date() },
					],
				});
				if (!reset) return false;
				await createVerification(auth, {
					identifier: identifier(CHALLENGE_PREFIX, challenge),
					value: reset.value,
					expiresAt: expiry(challengeTtl),
				});
				return true;
			});
			const location = exchanged
				? resetPath
				: "/forgot-password?reason=invalid";
			if (exchanged) {
				const challengeCookie = ctx.context.createAuthCookie(CHALLENGE_COOKIE, {
					httpOnly: true,
					sameSite: "lax",
					path: "/",
					maxAge: challengeTtl,
				});
				await ctx.setSignedCookie(
					challengeCookie.name,
					challenge,
					ctx.context.secret,
					challengeCookie.attributes,
				);
			}
			ctx.setHeader("cache-control", "no-store");
			ctx.setHeader("referrer-policy", "no-referrer");
			throw ctx.redirect(location);
		},
	);

	const challengeState = createAuthEndpoint(
		"/password-recovery/challenge-state",
		{ method: "GET" },
		async (ctx) => {
			const challengeCookie = ctx.context.createAuthCookie(CHALLENGE_COOKIE);
			const handle = await ctx.getSignedCookie(
				challengeCookie.name,
				ctx.context.secret,
			);
			if (!handle) return ctx.json({ status: "invalid" as const });
			const row = await ctx.context.adapter.findOne<VerificationRow>({
				model: "verification",
				where: [
					{ field: "identifier", value: identifier(CHALLENGE_PREFIX, handle) },
					{ field: "expiresAt", operator: "gt", value: new Date() },
				],
			});
			return ctx.json({
				status: row ? ("ready" as const) : ("invalid" as const),
			});
		},
	);

	const commit = createAuthEndpoint(
		"/password-recovery/commit",
		{
			method: "POST",
			body: z.object({ newPassword: z.string() }),
		},
		async (ctx) => {
			const challengeCookie = ctx.context.createAuthCookie(CHALLENGE_COOKIE);
			const handle = await ctx.getSignedCookie(
				challengeCookie.name,
				ctx.context.secret,
			);
			if (!handle)
				throw APIError.from("BAD_REQUEST", {
					code: "INVALID_PASSWORD_RECOVERY_CHALLENGE",
					message: "Invalid password recovery challenge",
				});
			const challenge = await ctx.context.adapter.findOne<VerificationRow>({
				model: "verification",
				where: [
					{ field: "identifier", value: identifier(CHALLENGE_PREFIX, handle) },
					{ field: "expiresAt", operator: "gt", value: new Date() },
				],
			});
			const recoveryUser = challenge
				? await ctx.context.adapter.findOne<AuthUser>({
						model: "user",
						where: [{ field: "id", value: challenge.value }],
					})
				: null;
			if (!recoveryUser)
				throw APIError.from("BAD_REQUEST", {
					code: "INVALID_PASSWORD_RECOVERY_CHALLENGE",
					message: "Invalid password recovery challenge",
				});
			const preparedPassword = options.preparePassword
				? await options.preparePassword({
						password: ctx.body.newPassword,
						user: recoveryUser as TUser,
					})
				: ctx.body.newPassword;
			if (!options.preparePassword) {
				const minimum = ctx.context.password.config.minPasswordLength;
				const maximum = ctx.context.password.config.maxPasswordLength;
				if (preparedPassword.length < minimum)
					throw APIError.from("BAD_REQUEST", {
						code: "PASSWORD_TOO_SHORT",
						message: "Password is too short",
					});
				if (preparedPassword.length > maximum)
					throw APIError.from("BAD_REQUEST", {
						code: "PASSWORD_TOO_LONG",
						message: "Password is too long",
					});
			}
			const hashedPassword = await ctx.context.password.hash(preparedPassword);
			await withAuthTransactionalQueue(ctx, async ({ auth, publish }) => {
				const challenge = await auth.consumeOne<VerificationRow>({
					model: "verification",
					where: [
						{
							field: "identifier",
							value: identifier(CHALLENGE_PREFIX, handle),
						},
						{ field: "expiresAt", operator: "gt", value: new Date() },
					],
				});
				if (!challenge)
					throw APIError.from("BAD_REQUEST", {
						code: "INVALID_PASSWORD_RECOVERY_CHALLENGE",
						message: "Invalid password recovery challenge",
					});
				const account = await auth.findOne<AccountRow>({
					model: "account",
					where: [
						{ field: "userId", value: challenge.value },
						{ field: "providerId", value: "credential" },
					],
				});
				const user = await auth.findOne<AuthUser>({
					model: "user",
					where: [{ field: "id", value: challenge.value }],
				});
				if (!account || !user)
					throw APIError.from("BAD_REQUEST", {
						code: "INVALID_PASSWORD_RECOVERY_CHALLENGE",
						message: "Invalid password recovery challenge",
					});
				await auth.update({
					model: "account",
					where: [{ field: "id", value: account.id }],
					update: { password: hashedPassword },
				});
				await auth.deleteMany({
					model: "session",
					where: [{ field: "userId", value: user.id }],
				});
				await auth.deleteMany({
					model: "verification",
					where: [
						{ field: "value", value: user.id },
						{
							field: "identifier",
							operator: "starts_with",
							value: "trust-device-",
						},
					],
				});
				for (const recoveryPrefix of [RESET_PREFIX, CHALLENGE_PREFIX]) {
					await auth.deleteMany({
						model: "verification",
						where: [
							{ field: "value", value: user.id },
							{
								field: "identifier",
								operator: "starts_with",
								value: recoveryPrefix,
							},
						],
					});
				}
				const occurredAt = new Date();
				const idempotencyKey = `password-recovery-committed:${digest(handle)}`;
				await options.notifyResetCommitted(
					{ user: user as TUser, occurredAt, idempotencyKey },
					{ publish },
				);
			});
			ctx.setCookie(challengeCookie.name, "", {
				...challengeCookie.attributes,
				maxAge: 0,
			});
			return ctx.json({ status: true });
		},
	);

	return {
		id: "questpie-password-recovery",
		endpoints: {
			request,
			requestState,
			resend,
			exchange,
			challengeState,
			commit,
		},
		rateLimit: [
			{
				pathMatcher: (path) => path === "/password-recovery/request",
				window: 60,
				max: 3,
			},
			{
				pathMatcher: (path) => path === "/password-recovery/resend",
				window: 60,
				max: 3,
			},
			{
				pathMatcher: (path) => path === "/password-recovery/commit",
				window: 60,
				max: 5,
			},
		],
		hooks: {
			before: [
				{
					matcher: (ctx) =>
						ctx.path === "/reset-password" ||
						ctx.path === "/request-password-reset",
					handler: createAuthMiddleware(async () => {
						throw APIError.from("NOT_FOUND", {
							code: "PASSWORD_RECOVERY_ROUTE_DISABLED",
							message: "Password recovery route disabled",
						});
					}),
				},
			],
		},
	};
}
