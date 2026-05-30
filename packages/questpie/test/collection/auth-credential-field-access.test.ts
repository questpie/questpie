import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import account from "../../src/server/modules/starter/collections/account";
import apikey from "../../src/server/modules/starter/collections/apikey";
import session from "../../src/server/modules/starter/collections/session";
import verification from "../../src/server/modules/starter/collections/verification";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
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

	it("strips credential material from user-mode reads", async () => {
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

		const readableSession = await setup.app.collections.session.findOne(
			{ where: { id: createdSession.id } },
			userCtx,
		);
		const readableAccount = await setup.app.collections.account.findOne(
			{ where: { id: createdAccount.id } },
			userCtx,
		);
		const readableApiKey = await setup.app.collections.apikey.findOne(
			{ where: { id: createdApiKey.id } },
			userCtx,
		);
		const readableVerification =
			await setup.app.collections.verification.findOne(
				{ where: { id: createdVerification.id } },
				userCtx,
			);

		expect(readableSession?.token).toBeUndefined();
		expect(readableSession?._title).toBe("user-1");
		expect(readableAccount?.accessToken).toBeUndefined();
		expect(readableAccount?.refreshToken).toBeUndefined();
		expect(readableAccount?.idToken).toBeUndefined();
		expect(readableAccount?.password).toBeUndefined();
		expect(readableApiKey?.key).toBeUndefined();
		expect(readableApiKey?._title).toBe("Production");
		expect(readableVerification?.value).toBeUndefined();
	});

	it("rejects user-mode writes to credential fields", async () => {
		const userCtx = createTestContext({ accessMode: "user", role: "user" });

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
		).rejects.toThrow("Cannot write field 'token': access denied");

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
		).rejects.toThrow("Cannot write field 'key': access denied");
	});
});
