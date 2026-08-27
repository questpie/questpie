import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { resolveIntrospectionAccess } from "../../src/server/collection/introspection";
import account from "../../src/server/modules/starter/collections/account";
import apikey from "../../src/server/modules/starter/collections/apikey";
import assets from "../../src/server/modules/starter/collections/assets";
import session from "../../src/server/modules/starter/collections/session";
import user from "../../src/server/modules/starter/collections/user";
import verification from "../../src/server/modules/starter/collections/verification";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createMockSession, createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

describe("starter auth credential collections", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({
			collections: { session, account, apikey, verification },
			defaultAccess: { read: true, create: true, update: true, delete: true },
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("denies user-mode reads of auth infrastructure collections", async () => {
		const systemCtx = createTestContext({ accessMode: "system" });
		const userCtx = createTestContext({ accessMode: "user", role: "user" });

		const createdSession = await setup.app.collections.session.create(
			{
				id: crypto.randomUUID(),
				userId: "user-1",
				token: "session-token",
				expiresAt: new Date(Date.now() + 60_000),
			},
			systemCtx,
		);
		const createdAccount = await setup.app.collections.account.create(
			{
				id: crypto.randomUUID(),
				userId: "user-1",
				accountId: "account-1",
				providerId: "github",
				accessToken: "access-token",
				refreshToken: "refresh-token",
				idToken: "id-token",
				password: "password-hash",
			},
			systemCtx,
		);
		const createdApiKey = await setup.app.collections.apikey.create(
			{
				id: crypto.randomUUID(),
				name: "Production",
				key: "api-key-secret",
				userId: "user-1",
			},
			systemCtx,
		);
		const createdVerification = await setup.app.collections.verification.create(
			{
				id: crypto.randomUUID(),
				identifier: "user@example.com",
				value: "verification-code",
				expiresAt: new Date(Date.now() + 60_000),
			},
			systemCtx,
		);

		await expect(
			setup.app.collections.session.findOne(
				{ where: { id: createdSession.id } },
				userCtx,
			),
		).rejects.toThrow("permission to read");
		await expect(
			setup.app.collections.account.findOne(
				{ where: { id: createdAccount.id } },
				userCtx,
			),
		).rejects.toThrow("permission to read");
		await expect(
			setup.app.collections.apikey.findOne(
				{ where: { id: createdApiKey.id } },
				userCtx,
			),
		).rejects.toThrow("permission to read");
		await expect(
			setup.app.collections.verification.findOne(
				{ where: { id: createdVerification.id } },
				userCtx,
			),
		).rejects.toThrow("permission to read");
		await expect(
			setup.app.collections.session.count({}, userCtx),
		).rejects.toThrow("permission to read");
		expect(
			await resolveIntrospectionAccess(
				session.state,
				{ ...userCtx, db: setup.app.db },
				setup.app,
			),
		).toBe(false);
	});

	it("rejects every user-mode write to auth infrastructure collections", async () => {
		const systemCtx = createTestContext({ accessMode: "system" });
		const userCtx = createTestContext({ accessMode: "user", role: "user" });
		const created = await setup.app.collections.session.create(
			{
				id: crypto.randomUUID(),
				userId: "user-1",
				token: "existing-session-token",
				expiresAt: new Date(Date.now() + 60_000),
			},
			systemCtx,
		);

		await expect(
			setup.app.collections.session.create(
				{
					id: crypto.randomUUID(),
					userId: "user-1",
					token: "session-token",
					expiresAt: new Date(Date.now() + 60_000),
				},
				userCtx,
			),
		).rejects.toThrow("Access denied");

		await expect(
			setup.app.collections.apikey.create(
				{
					id: crypto.randomUUID(),
					name: "Production",
					key: "api-key-secret",
					userId: "user-1",
				},
				userCtx,
			),
		).rejects.toThrow("Access denied");
		await expect(
			setup.app.collections.session.updateById(
				{
					id: created.id,
					data: { expiresAt: new Date(Date.now() + 120_000) },
				},
				userCtx,
			),
		).rejects.toThrow("Access denied");
		await expect(
			setup.app.collections.session.deleteById({ id: created.id }, userCtx),
		).rejects.toThrow("Access denied");
		await expect(
			setup.app.collections.session.deleteMany(
				{ where: { userId: "user-1" } },
				userCtx,
			),
		).rejects.toThrow("permission");

		expect(
			await setup.app.collections.session.findOne(
				{ where: { id: created.id } },
				systemCtx,
			),
		).toMatchObject({ id: created.id, token: "existing-session-token" });
	});
});

describe("starter user collection access", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({
			collections: { user, assets },
			defaultAccess: { read: true, create: true, update: true, delete: true },
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("allows self profile access without permitting authority escalation", async () => {
		const systemCtx = createTestContext({ accessMode: "system" });
		const selfId = crypto.randomUUID();
		const otherId = crypto.randomUUID();
		const selfCtx = createTestContext({
			accessMode: "user",
			session: createMockSession({ id: selfId, role: "user" }),
		});

		await setup.app.collections.user.create(
			{
				id: selfId,
				name: "Self",
				email: "self@example.com",
				emailVerified: true,
				role: "user",
			},
			systemCtx,
		);
		await setup.app.collections.user.create(
			{
				id: otherId,
				name: "Other",
				email: "other@example.com",
				emailVerified: true,
				role: "user",
			},
			systemCtx,
		);

		expect(
			await setup.app.collections.user.findOne(
				{ where: { id: selfId } },
				selfCtx,
			),
		).toMatchObject({ id: selfId, name: "Self" });
		expect(
			await setup.app.collections.user.findOne(
				{ where: { id: otherId } },
				selfCtx,
			),
		).toBeNull();

		await expect(
			setup.app.collections.user.updateById(
				{ id: selfId, data: { role: "admin" } },
				selfCtx,
			),
		).rejects.toThrow("Cannot write field 'role': access denied");
		await expect(
			setup.app.collections.user.updateById(
				{ id: selfId, data: { email: "attacker@example.com" } },
				selfCtx,
			),
		).rejects.toThrow("Cannot write field 'email': access denied");
		await expect(
			setup.app.collections.user.updateById(
				{ id: otherId, data: { name: "Compromised" } },
				selfCtx,
			),
		).rejects.toThrow();

		const updated = await setup.app.collections.user.updateById(
			{ id: selfId, data: { name: "Renamed" } },
			selfCtx,
		);
		expect(updated.name).toBe("Renamed");
	});

	it("preserves explicit administrator management", async () => {
		const systemCtx = createTestContext({ accessMode: "system" });
		const targetId = crypto.randomUUID();
		const adminCtx = createTestContext({
			accessMode: "user",
			session: createMockSession({ role: "admin" }),
		});

		await setup.app.collections.user.create(
			{
				id: targetId,
				name: "Target",
				email: "target@example.com",
				emailVerified: true,
				role: "user",
			},
			systemCtx,
		);

		const updated = await setup.app.collections.user.updateById(
			{ id: targetId, data: { role: "admin", emailVerified: false } },
			adminCtx,
		);
		expect(updated.role).toBe("admin");
		expect(updated.emailVerified).toBe(false);
	});
});
