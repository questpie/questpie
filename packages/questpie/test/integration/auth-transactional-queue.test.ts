import {
	afterEach,
	beforeEach,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from "bun:test";

import type { BetterAuthPlugin } from "better-auth";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { withAuthTransactionalQueue } from "../../src/exports/auth.js";
import { job } from "../../src/exports/index.js";
import { questpieQueueDispatchTable } from "../../src/server/modules/core/integrated/queue/dispatch-table.js";
import verification from "../../src/server/modules/starter/collections/verification.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../utils/test-db.js";

const sendVerificationJob = job({
	name: "send-auth-verification",
	schema: z.object({ verificationId: z.string(), token: z.string() }),
	handler: async () => {},
});

const collidingRegistrationJob = job({
	name: "different-auth-job",
	schema: z.object({ verificationId: z.string(), token: z.string() }),
	handler: async () => {},
});

setDefaultTimeout(30_000);

describe("Auth transactional Queue bridge", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	function verificationData(id: string) {
		return {
			id,
			identifier: "user@example.test",
			value: "hashed-value",
			expiresAt: new Date(Date.now() + 60_000),
			createdAt: new Date(),
			updatedAt: new Date(),
		};
	}

	beforeEach(async () => {
		setup = await buildMockApp(
			{
				collections: { verification },
				jobs: { sendVerification: sendVerificationJob },
			},
			{ secret: "test-auth-queue-secret-at-least-32-bytes" },
		);
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup?.cleanup();
	});

	test("rolls back Auth state and dispatch together after publication", async () => {
		const context = await setup.app.auth.$context;

		await expect(
			withAuthTransactionalQueue({ context }, async ({ auth, publish }) => {
				await auth.create({
					model: "verification",
					data: verificationData("verification-rollback"),
					forceAllowId: true,
				});
				await publish(
					sendVerificationJob,
					{
						verificationId: "verification-rollback",
						token: "raw-secret-token",
					},
					{ idempotencyKey: "auth-verification:rollback" },
				);
				throw new Error("simulated crash after publication");
			}),
		).rejects.toThrow("simulated crash after publication");

		expect(
			await context.adapter.findOne({
				model: "verification",
				where: [{ field: "id", value: "verification-rollback" }],
			}),
		).toBeNull();
		expect(
			await setup.app.db
				.select()
				.from(questpieQueueDispatchTable)
				.where(
					eq(
						questpieQueueDispatchTable.idempotencyKey,
						"auth-verification:rollback",
					),
				),
		).toEqual([]);
		expect(setup.app.mocks.queue.getJobs()).toEqual([]);
	});

	test("commits Auth state and one encrypted durable dispatch together", async () => {
		const context = await setup.app.auth.$context;
		const dispatchId = await withAuthTransactionalQueue(
			{ context },
			async ({ auth, publish }) => {
				await auth.create({
					model: "verification",
					data: verificationData("verification-commit"),
					forceAllowId: true,
				});
				return publish(
					sendVerificationJob,
					{
						verificationId: "verification-commit",
						token: "raw-secret-token",
					},
					{ idempotencyKey: "auth-verification:commit" },
				);
			},
		);

		expect(
			await context.adapter.findOne({
				model: "verification",
				where: [{ field: "id", value: "verification-commit" }],
			}),
		).toMatchObject({ id: "verification-commit" });
		expect(dispatchId).toBeString();
		expect(setup.app.mocks.queue.getJobs()).toHaveLength(1);
		const [dispatch] = await setup.app.db
			.select()
			.from(questpieQueueDispatchTable)
			.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
		expect(dispatch).toMatchObject({
			dispatchId,
			idempotencyKey: "auth-verification:commit",
			jobName: "send-auth-verification",
			status: "accepted",
			payload: null,
		});
		expect(JSON.stringify(dispatch)).not.toContain("raw-secret-token");
	});

	test("a crash before publication rolls back Auth state without a dispatch", async () => {
		const context = await setup.app.auth.$context;

		await expect(
			withAuthTransactionalQueue({ context }, async ({ auth }) => {
				await auth.create({
					model: "verification",
					data: verificationData("verification-before-publish"),
					forceAllowId: true,
				});
				throw new Error("simulated crash before publication");
			}),
		).rejects.toThrow("simulated crash before publication");

		expect(
			await context.adapter.findOne({
				model: "verification",
				where: [{ field: "id", value: "verification-before-publish" }],
			}),
		).toBeNull();
		expect(
			await setup.app.db.select().from(questpieQueueDispatchTable),
		).toEqual([]);
	});

	test("recovers a committed Auth dispatch when adapter publication is interrupted", async () => {
		const context = await setup.app.auth.$context;
		setup.app.mocks.queue.failNextPublishes(1);

		const dispatchId = await withAuthTransactionalQueue(
			{ context },
			async ({ auth, publish }) => {
				await auth.create({
					model: "verification",
					data: verificationData("verification-recovery"),
					forceAllowId: true,
				});
				return publish(
					sendVerificationJob,
					{
						verificationId: "verification-recovery",
						token: "raw-secret-token",
					},
					{ idempotencyKey: "auth-verification:recovery" },
				);
			},
		);

		expect(
			await context.adapter.findOne({
				model: "verification",
				where: [{ field: "id", value: "verification-recovery" }],
			}),
		).toMatchObject({ id: "verification-recovery" });
		expect(setup.app.mocks.queue.getJobs()).toEqual([]);
		expect(
			await setup.app.db
				.select()
				.from(questpieQueueDispatchTable)
				.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId)),
		).toMatchObject([{ dispatchId, status: "pending" }]);

		await setup.app.db
			.update(questpieQueueDispatchTable)
			.set({ availableAt: new Date(0) })
			.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
		await setup.app.queue.drain();

		expect(setup.app.mocks.queue.getJobs()).toHaveLength(1);
		expect(await setup.app.queue.getReceipt(dispatchId)).toMatchObject({
			dispatchId,
			status: "queued",
		});
	});

	test("two racing Auth claims create one logical dispatch", async () => {
		const context = await setup.app.auth.$context;
		await context.adapter.create({
			model: "verification",
			data: verificationData("verification-race"),
			forceAllowId: true,
		});

		const results = await Promise.all(
			["first", "second"].map((attempt) =>
				withAuthTransactionalQueue({ context }, async ({ auth, publish }) => {
					const claim = await auth.consumeOne({
						model: "verification",
						where: [{ field: "id", value: "verification-race" }],
					});
					if (!claim) return null;
					return publish(
						sendVerificationJob,
						{
							verificationId: "verification-race",
							token: `raw-secret-${attempt}`,
						},
						{ idempotencyKey: "auth-verification:race" },
					);
				}),
			),
		);

		expect(results.filter(Boolean)).toHaveLength(1);
		expect(setup.app.mocks.queue.getJobs()).toHaveLength(1);
		expect(
			await setup.app.db
				.select()
				.from(questpieQueueDispatchTable)
				.where(
					eq(
						questpieQueueDispatchTable.idempotencyKey,
						"auth-verification:race",
					),
				),
		).toHaveLength(1);
	});

	test("leaves ordinary Better Auth adapter use unchanged when the bridge is unused", async () => {
		const context = await setup.app.auth.$context;
		await context.adapter.create({
			model: "verification",
			data: verificationData("verification-ordinary"),
			forceAllowId: true,
		});

		expect(
			await context.adapter.findOne({
				model: "verification",
				where: [{ field: "id", value: "verification-ordinary" }],
			}),
		).toMatchObject({ id: "verification-ordinary" });
		expect(
			await setup.app.db.select().from(questpieQueueDispatchTable),
		).toEqual([]);
		expect(setup.app.mocks.queue.getJobs()).toEqual([]);
	});

	test("rejects an unregistered job capability and rolls back Auth state", async () => {
		const context = await setup.app.auth.$context;
		const unregisteredJob = job({
			name: "unregistered-auth-job",
			schema: z.object({ token: z.string() }),
			handler: async () => {},
		});

		await expect(
			withAuthTransactionalQueue({ context }, async ({ auth, publish }) => {
				await auth.create({
					model: "verification",
					data: verificationData("verification-unregistered"),
					forceAllowId: true,
				});
				await publish(
					unregisteredJob,
					{ token: "raw-secret-token" },
					{ idempotencyKey: "auth-verification:unregistered" },
				);
			}),
		).rejects.toThrow("is not registered by this app");

		expect(
			await context.adapter.findOne({
				model: "verification",
				where: [{ field: "id", value: "verification-unregistered" }],
			}),
		).toBeNull();
		expect(
			await setup.app.db.select().from(questpieQueueDispatchTable),
		).toEqual([]);
	});

	test("keeps the bridge on Better Auth request-scoped context clones", async () => {
		const context = await setup.app.auth.$context;
		const requestContext = { ...context };

		await expect(
			withAuthTransactionalQueue(
				{ context: requestContext },
				async ({ publish }) =>
					publish(
						sendVerificationJob,
						{
							verificationId: "verification-request-context",
							token: "raw-secret-token",
						},
						{ idempotencyKey: "auth-verification:request-context" },
					),
			),
		).resolves.toBeString();
	});

	test("does not expose the general Queue capability to sibling Auth plugins", async () => {
		const context = await setup.app.auth.$context;
		const descriptors = Object.getOwnPropertyDescriptors(context);
		const ownValues = Reflect.ownKeys(context).map(
			(key) => descriptors[key as keyof typeof descriptors]?.value,
		);
		const leakedRuntime = ownValues.find((value): value is object => {
			if (!value || typeof value !== "object") return false;
			return (
				"getQueue" in value &&
				typeof (value as { getQueue?: unknown }).getQueue === "function"
			);
		});

		expect(leakedRuntime).toBeUndefined();
		expect(Reflect.ownKeys(context).map((key) => String(key))).not.toContain(
			"Symbol(questpie.authTransactionalQueueRuntime)",
		);
	});

	test("fails closed when a user plugin replaces the framework-owned Auth adapter", async () => {
		await setup.cleanup();
		const replaceAdapterPlugin = {
			id: "replace-framework-auth-adapter",
			init(context) {
				const frameworkAdapter = context.adapter;
				return {
					context: {
						adapter: {
							...frameworkAdapter,
							transaction: async (callback) => callback(frameworkAdapter),
						},
					},
				};
			},
		} satisfies BetterAuthPlugin;
		setup = await buildMockApp(
			{
				collections: { verification },
				jobs: { sendVerification: sendVerificationJob },
				auth: { plugins: [replaceAdapterPlugin] },
			},
			{ secret: "test-auth-queue-secret-at-least-32-bytes" },
		);
		await runTestDbMigrations(setup.app);
		const context = await setup.app.auth.$context;

		await expect(
			withAuthTransactionalQueue({ context }, async ({ auth, publish }) => {
				await auth.create({
					model: "verification",
					data: verificationData("verification-replaced-adapter"),
					forceAllowId: true,
				});
				await publish(
					sendVerificationJob,
					{
						verificationId: "verification-replaced-adapter",
						token: "raw-secret-token",
					},
					{ idempotencyKey: "auth-verification:replaced-adapter" },
				);
				throw new Error("hostile adapter bypassed the framework transaction");
			}),
		).rejects.toThrow(
			"Auth transactional Queue bridge is unavailable on this Auth context",
		);

		expect(
			await context.adapter.findOne({
				model: "verification",
				where: [{ field: "id", value: "verification-replaced-adapter" }],
			}),
		).toBeNull();
		expect(
			await setup.app.db.select().from(questpieQueueDispatchTable),
		).toEqual([]);
		expect(setup.app.mocks.queue.getJobs()).toEqual([]);
	});

	test("publishes through the matched registration key when a job name collides", async () => {
		await setup.cleanup();
		setup = await buildMockApp(
			{
				collections: { verification },
				jobs: {
					safeVerification: sendVerificationJob,
					"send-auth-verification": collidingRegistrationJob,
				},
			},
			{ secret: "test-auth-queue-secret-at-least-32-bytes" },
		);
		await runTestDbMigrations(setup.app);
		const context = await setup.app.auth.$context;

		await withAuthTransactionalQueue({ context }, async ({ publish }) =>
			publish(
				sendVerificationJob,
				{
					verificationId: "verification-registration-collision",
					token: "raw-secret-token",
				},
				{ idempotencyKey: "auth-verification:registration-collision" },
			),
		);

		expect(setup.app.mocks.queue.getJobs()).toMatchObject([
			{ name: "send-auth-verification" },
		]);
		expect(
			await setup.app.db
				.select({ jobName: questpieQueueDispatchTable.jobName })
				.from(questpieQueueDispatchTable),
		).toEqual([{ jobName: "send-auth-verification" }]);
	});
});
