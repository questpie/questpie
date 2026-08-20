import {
	afterEach,
	beforeEach,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from "bun:test";

import { z } from "zod";

import { passwordRecovery } from "../../src/exports/auth.js";
import { job } from "../../src/exports/index.js";
import account from "../../src/server/modules/starter/collections/account.js";
import assets from "../../src/server/modules/starter/collections/assets.js";
import session from "../../src/server/modules/starter/collections/session.js";
import user from "../../src/server/modules/starter/collections/user.js";
import verification from "../../src/server/modules/starter/collections/verification.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../utils/test-db.js";

const resetEmail = job({
	name: "password-recovery-link",
	schema: z.object({
		userId: z.string().nullable(),
		exchangeUrl: z.string().nullable(),
	}),
	handler: async () => {},
});

const securityEmail = job({
	name: "password-recovery-committed",
	schema: z.object({ userId: z.string(), occurredAt: z.string() }),
	handler: async () => {},
});

type VerificationRowForTest = {
	identifier: string;
	value: string;
	expiresAt: Date;
};

setDefaultTimeout(30_000);

describe("passwordRecovery", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let dispatchedExchangeUrl: string | undefined;
	let failSecurityDispatch = false;

	beforeEach(async () => {
		dispatchedExchangeUrl = undefined;
		failSecurityDispatch = false;
		setup = await buildMockApp(
			{
				collections: { user, account, session, verification, assets },
				jobs: { resetEmail, securityEmail },
				auth: {
					emailAndPassword: {
						enabled: true,
						minPasswordLength: 8,
						maxPasswordLength: 128,
					},
					plugins: [
						passwordRecovery({
							deliverResetLink: async (
								{ user, exchangeUrl, idempotencyKey },
								{ publish },
							) => {
								dispatchedExchangeUrl = exchangeUrl ?? undefined;
								await publish(
									resetEmail,
									{ userId: user?.id ?? null, exchangeUrl },
									{ idempotencyKey },
								);
							},
							notifyResetCommitted: async (
								{ user, occurredAt, idempotencyKey },
								{ publish },
							) => {
								if (failSecurityDispatch)
									throw new Error("security dispatch unavailable");
								await publish(
									securityEmail,
									{ userId: user.id, occurredAt: occurredAt.toISOString() },
									{ idempotencyKey },
								);
							},
						}),
					],
				},
			},
			{ secret: "test-password-recovery-secret-at-least-32-bytes" },
		);
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup?.cleanup();
	});

	const request = (path: string, init?: RequestInit) =>
		setup.app.auth.handler(
			new Request(`http://localhost:3000/api/auth${path}`, {
				...init,
				headers: {
					origin: "http://localhost:3000",
					...(init?.body ? { "content-type": "application/json" } : {}),
					...init?.headers,
				},
			}),
		);

	async function seedCredentialIdentity(
		userId: string,
		email: string,
		password: string,
	) {
		const context = await setup.app.auth.$context;
		await context.adapter.create({
			model: "user",
			forceAllowId: true,
			data: {
				id: userId,
				email,
				name: "Owner",
				emailVerified: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		});
		await context.adapter.create({
			model: "account",
			data: {
				userId,
				accountId: userId,
				providerId: "credential",
				password: await context.password.hash(password),
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		});
		return context;
	}

	test("exchanges a hashed one-use token and commits password, revocation and notification once", async () => {
		const userId = "password-recovery-user";
		const context = await seedCredentialIdentity(
			userId,
			"owner@example.test",
			"old-password",
		);
		await context.adapter.create({
			model: "session",
			data: {
				userId,
				token: "old-session",
				expiresAt: new Date(Date.now() + 60_000),
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		});
		await context.adapter.create({
			model: "verification",
			data: {
				identifier: "trust-device-existing",
				value: userId,
				expiresAt: new Date(Date.now() + 60_000),
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		});
		await context.adapter.create({
			model: "verification",
			data: {
				identifier: "2fa-otp-existing",
				value: userId,
				expiresAt: new Date(Date.now() + 60_000),
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		});
		await context.adapter.create({
			model: "account",
			data: {
				userId,
				accountId: "oauth-subject",
				providerId: "github",
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		});

		const requested = await request("/password-recovery/request", {
			method: "POST",
			body: JSON.stringify({ email: "owner@example.test" }),
		});
		expect(requested.status).toBe(200);
		expect(await requested.json()).toEqual({ status: true });
		const requestStateCookie = requested.headers
			.get("set-cookie")
			?.split(";")[0];
		expect(requestStateCookie).toContain("password_recovery_request=");
		const state = await request("/password-recovery/request-state", {
			headers: { cookie: requestStateCookie! },
		});
		expect(await state.json()).toMatchObject({
			status: "ready",
			maskedEmail: "ow•••@example.test",
		});
		const earlyResend = await request("/password-recovery/resend", {
			method: "POST",
			headers: { cookie: requestStateCookie! },
		});
		const earlyResendBody = await earlyResend.json();
		expect(earlyResendBody).toMatchObject({ status: "cooldown" });
		expect(earlyResend.status).toBe(429);
		const requestStateRow = (
			await context.adapter.findMany<VerificationRowForTest>({
				model: "verification",
			})
		).find((row) => row.value.includes('"email":"owner@example.test"'));
		expect(requestStateRow).toBeDefined();
		const requestStateValue = JSON.parse(requestStateRow!.value) as Record<
			string,
			unknown
		>;
		await context.adapter.update({
			model: "verification",
			where: [{ field: "identifier", value: requestStateRow!.identifier }],
			update: {
				value: JSON.stringify({
					...requestStateValue,
					retryAt: new Date(0).toISOString(),
				}),
			},
		});
		const racingResends = await Promise.all(
			["first", "second"].map(() =>
				request("/password-recovery/resend", {
					method: "POST",
					headers: { cookie: requestStateCookie! },
				}),
			),
		);
		expect(
			racingResends.filter((response) => response.status === 200),
		).toHaveLength(1);
		const resetDispatch = setup.app.mocks.queue
			.getJobs()
			.find((entry) => entry.name === resetEmail.name);
		expect(resetDispatch).toBeDefined();
		expect(
			setup.app.mocks.queue
				.getJobs()
				.filter((entry) => entry.name === resetEmail.name),
		).toHaveLength(2);
		const exchangeUrl = dispatchedExchangeUrl;
		expect(exchangeUrl).toStartWith(
			"http://localhost:3000/api/auth/password-recovery/exchange?token=",
		);
		const rawToken = new URL(exchangeUrl!).searchParams.get("token");
		expect(rawToken).toBeString();
		const persisted = await context.adapter.findMany<{ identifier: string }>({
			model: "verification",
		});
		expect(JSON.stringify(persisted)).not.toContain(rawToken!);

		const exchanged = await request(
			`/password-recovery/exchange?token=${encodeURIComponent(rawToken!)}`,
			{ redirect: "manual" },
		);
		expect(exchanged.status).toBeGreaterThanOrEqual(300);
		expect(exchanged.status).toBeLessThan(400);
		expect(exchanged.headers.get("location")).toBe("/reset-password");
		expect(exchanged.headers.get("cache-control")).toBe("no-store");
		expect(exchanged.headers.get("referrer-policy")).toBe("no-referrer");
		const challengeCookie = exchanged.headers.get("set-cookie")?.split(";")[0];
		expect(challengeCookie).toContain("password_recovery_challenge=");
		for (const invalidUrl of [
			"/password-recovery/exchange?token=short",
			`/password-recovery/exchange?token=${encodeURIComponent(rawToken!)}`,
		]) {
			const invalid = await request(invalidUrl, { redirect: "manual" });
			expect(invalid.status).toBeGreaterThanOrEqual(300);
			expect(invalid.status).toBeLessThan(400);
			expect(invalid.headers.get("location")).toBe(
				"/forgot-password?reason=invalid",
			);
		}

		const commits = await Promise.all(
			["first", "second"].map(() =>
				request("/password-recovery/commit", {
					method: "POST",
					headers: { cookie: challengeCookie! },
					body: JSON.stringify({ newPassword: "new-password" }),
				}),
			),
		);
		expect(commits.filter((response) => response.status === 200)).toHaveLength(
			1,
		);
		expect(commits.filter((response) => response.status === 400)).toHaveLength(
			1,
		);
		expect(
			await context.adapter.findMany({
				model: "session",
				where: [{ field: "userId", value: userId }],
			}),
		).toEqual([]);
		expect(
			await context.adapter.findOne({
				model: "verification",
				where: [{ field: "identifier", value: "2fa-otp-existing" }],
			}),
		).not.toBeNull();
		expect(
			await context.adapter.findOne({
				model: "account",
				where: [
					{ field: "userId", value: userId },
					{ field: "providerId", value: "github" },
				],
			}),
		).not.toBeNull();
		expect(
			await context.adapter.findMany({
				model: "verification",
				where: [
					{
						field: "identifier",
						operator: "starts_with",
						value: "trust-device-",
					},
				],
			}),
		).toEqual([]);
		expect(
			setup.app.mocks.queue
				.getJobs()
				.filter((entry) => entry.name === securityEmail.name),
		).toHaveLength(1);
		const credential = await context.adapter.findOne<{ password: string }>({
			model: "account",
			where: [
				{ field: "userId", value: userId },
				{ field: "providerId", value: "credential" },
			],
		});
		expect(
			await context.password.verify({
				hash: credential!.password,
				password: "new-password",
			}),
		).toBe(true);
		expect(
			await context.password.verify({
				hash: credential!.password,
				password: "old-password",
			}),
		).toBe(false);
	});

	test("returns the same public request result for unknown and social-only identities", async () => {
		const context = await setup.app.auth.$context;
		await context.adapter.create({
			model: "user",
			forceAllowId: true,
			data: {
				id: "social-only-user",
				email: "social@example.test",
				name: "Social User",
				emailVerified: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		});
		await context.adapter.create({
			model: "account",
			data: {
				userId: "social-only-user",
				accountId: "provider-subject",
				providerId: "github",
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		});
		const unknown = await request("/password-recovery/request", {
			method: "POST",
			body: JSON.stringify({ email: "unknown@example.test" }),
		});
		const socialOnly = await request("/password-recovery/request", {
			method: "POST",
			body: JSON.stringify({ email: "social@example.test" }),
		});
		expect(unknown.status).toBe(200);
		expect(socialOnly.status).toBe(200);
		expect(await unknown.json()).toEqual(await socialOnly.json());
	});

	test("rolls the reset back when the durable security notification cannot be published", async () => {
		const userId = "password-recovery-rollback";
		const context = await seedCredentialIdentity(
			userId,
			"rollback@example.test",
			"old-password",
		);
		await context.adapter.create({
			model: "session",
			data: {
				userId,
				token: "rollback-session",
				expiresAt: new Date(Date.now() + 60_000),
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		});
		await request("/password-recovery/request", {
			method: "POST",
			body: JSON.stringify({ email: "rollback@example.test" }),
		});
		const rawToken = new URL(dispatchedExchangeUrl!).searchParams.get("token")!;
		const exchanged = await request(
			`/password-recovery/exchange?token=${encodeURIComponent(rawToken)}`,
			{ redirect: "manual" },
		);
		const challengeCookie = exchanged.headers.get("set-cookie")?.split(";")[0];
		failSecurityDispatch = true;
		const failed = await request("/password-recovery/commit", {
			method: "POST",
			headers: { cookie: challengeCookie! },
			body: JSON.stringify({ newPassword: "new-password" }),
		});
		expect(failed.status).toBe(500);
		const credential = await context.adapter.findOne<{ password: string }>({
			model: "account",
			where: [
				{ field: "userId", value: userId },
				{ field: "providerId", value: "credential" },
			],
		});
		expect(
			await context.password.verify({
				hash: credential!.password,
				password: "old-password",
			}),
		).toBe(true);
		expect(
			await context.adapter.findMany({
				model: "session",
				where: [{ field: "userId", value: userId }],
			}),
		).toHaveLength(1);
		failSecurityDispatch = false;
		const retried = await request("/password-recovery/commit", {
			method: "POST",
			headers: { cookie: challengeCookie! },
			body: JSON.stringify({ newPassword: "new-password" }),
		});
		expect(retried.status).toBe(200);
	});
});
