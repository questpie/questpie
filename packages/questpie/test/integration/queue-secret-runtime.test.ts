import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { job } from "../../src/exports/index.js";
import {
	completeQueueDispatch,
	failQueueDispatch,
} from "../../src/server/modules/core/integrated/queue/dispatch-store.js";
import { createQueueClient } from "../../src/server/modules/core/integrated/queue/service.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../utils/test-db.js";

const rootSecret = "queue-secret-root-key-at-least-32-bytes";
let handled = 0;
let providerEffects = 0;
let providerAttempts = 0;
let blockHandler = false;
let signalHandlerStarted: (() => void) | undefined;
let releaseHandler: (() => void) | undefined;
const acceptedDispatches = new Set<string>();

const secretDeliveryJob = job({
	name: "secret-delivery",
	schema: z.object({ rawSecret: z.string() }),
	handler: async ({ dispatchId }) => {
		handled += 1;
		providerAttempts += 1;
		if (dispatchId && !acceptedDispatches.has(dispatchId)) {
			acceptedDispatches.add(dispatchId);
			providerEffects += 1;
		}
		signalHandlerStarted?.();
		if (blockHandler) {
			await new Promise<void>((resolve) => {
				releaseHandler = resolve;
			});
		}
	},
});

describe("secret-bearing Queue runtime", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		handled = 0;
		providerEffects = 0;
		providerAttempts = 0;
		blockHandler = false;
		signalHandlerStarted = undefined;
		releaseHandler = undefined;
		acceptedDispatches.clear();
		setup = await buildMockApp(
			{ jobs: { secretDelivery: secretDeliveryJob } },
			{ secret: rootSecret },
		);
		await runTestDbMigrations(setup.app);
		await setup.app.queue.listen({ gracefulShutdown: false });
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	test("acknowledges a duplicate physical delivery after crypto-erasure without running user code again", async () => {
		await setup.app.queue.secretDelivery.publish(
			{ rawSecret: "one-time-secret" },
			{
				idempotencyKey: "secret-delivery:one",
				secretPayload: true,
			},
		);
		const [physicalJob] = setup.app.mocks.queue.getJobs();
		expect(physicalJob).toBeDefined();

		await setup.app.mocks.queue.processJob(physicalJob!.id);
		await expect(
			setup.app.mocks.queue.processJob(physicalJob!.id),
		).resolves.toBeUndefined();

		expect(handled).toBe(1);
	});

	test("serializes concurrent physical deliveries and lets the successful claimant dominate a final failure", async () => {
		blockHandler = true;
		const handlerStarted = new Promise<void>((resolve) => {
			signalHandlerStarted = resolve;
		});
		const dispatchId = await setup.app.queue.secretDelivery.publish(
			{ rawSecret: "concurrent-one-time-secret" },
			{
				idempotencyKey: "secret-delivery:concurrent-success-failure",
				secretPayload: true,
			},
		);
		const [physicalJob] = setup.app.mocks.queue.getJobs();
		expect(physicalJob).toBeDefined();

		const successfulDelivery = setup.app.mocks.queue.processJob(
			physicalJob!.id,
		);
		await handlerStarted;
		const losingDelivery = setup.app.mocks.queue.processJob(physicalJob!.id);
		await expect(losingDelivery).rejects.toThrow(
			"QUESTPIE Queue secret job handling failed",
		);

		releaseHandler?.();
		await successfulDelivery;

		expect(handled).toBe(1);
		expect(await setup.app.queue.getReceipt(dispatchId!)).toMatchObject({
			status: "completed",
		});
	});

	test("makes success/success idempotent and completed dominate concurrent or later failure transitions", async () => {
		const dispatchId = await setup.app.queue.secretDelivery.publish(
			{ rawSecret: "monotonic-transition-secret" },
			{
				idempotencyKey: "secret-delivery:monotonic-transitions",
				secretPayload: true,
			},
		);

		await Promise.all([
			completeQueueDispatch(setup.app.db, dispatchId!),
			completeQueueDispatch(setup.app.db, dispatchId!),
			failQueueDispatch(setup.app.db, dispatchId!),
		]);
		await failQueueDispatch(setup.app.db, dispatchId!);

		expect(await setup.app.queue.getReceipt(dispatchId!)).toMatchObject({
			status: "completed",
		});
	});

	test("retries provider acceptance after one receipt-write failure and records one completed receipt", async () => {
		const dispatchId = await setup.app.queue.secretDelivery.publish(
			{ rawSecret: "provider-success-receipt-failure-secret" },
			{
				idempotencyKey: "secret-delivery:receipt-write-retry",
				secretPayload: true,
			},
		);
		const [physicalJob] = setup.app.mocks.queue.getJobs();
		expect(physicalJob).toBeDefined();

		await setup.app.db.execute(
			sql.raw("CREATE SEQUENCE queue_secret_receipt_failure_once START 1"),
		);
		await setup.app.db.execute(
			sql.raw(`
			CREATE FUNCTION queue_secret_fail_first_completion()
			RETURNS trigger
			LANGUAGE plpgsql
			AS $$
			BEGIN
				IF NEW.dispatch_id::text = '${dispatchId}' AND NEW.status = 'completed'
					AND nextval('queue_secret_receipt_failure_once') = 1
				THEN
					RAISE EXCEPTION 'injected receipt write failure';
				END IF;
				RETURN NEW;
			END;
			$$
		`),
		);
		await setup.app.db.execute(
			sql.raw(`
			CREATE TRIGGER queue_secret_fail_first_completion
			BEFORE UPDATE ON questpie_queue_dispatch
			FOR EACH ROW EXECUTE FUNCTION queue_secret_fail_first_completion()
		`),
		);

		await expect(
			setup.app.mocks.queue.processJob(physicalJob!.id),
		).rejects.toThrow("QUESTPIE Queue secret job handling failed");
		await setup.app.mocks.queue.processJob(physicalJob!.id);

		expect(providerAttempts).toBe(2);
		expect(providerEffects).toBe(1);
		expect(await setup.app.queue.getReceipt(dispatchId!)).toMatchObject({
			status: "completed",
		});
	});

	test("sanitizes secret schema/refinement failures before they leave the framework", async () => {
		const rawSecret = "schema-refinement-raw-secret";
		const logLines: string[] = [];
		const refinementJob = job({
			name: "secret-refinement",
			schema: z.object({ rawSecret: z.string() }).superRefine((payload) => {
				throw new Error(`refinement rejected ${payload.rawSecret}`);
			}),
			handler: async () => {},
		});
		const queue = createQueueClient(
			{ refinement: refinementJob },
			setup.app.mocks.queue,
			{
				getDatabase: () => setup.app.db,
				secret: rootSecret,
				logger: {
					info: (...args) => logLines.push(JSON.stringify(args)),
					warn: (...args) => logLines.push(JSON.stringify(args)),
					error: (...args) => logLines.push(JSON.stringify(args)),
				},
			},
		);

		let captured: unknown;
		try {
			await queue.refinement.publish(
				{ rawSecret },
				{
					idempotencyKey: "secret-refinement:v1",
					secretPayload: true,
				},
			);
		} catch (error) {
			captured = error;
		}

		expect(captured).toBeInstanceOf(Error);
		expect((captured as Error).message).toBe(
			"QUESTPIE Queue secret payload validation failed",
		);
		expect((captured as Error & { cause?: unknown }).cause).toBeUndefined();
		expect(JSON.stringify(captured)).not.toContain(rawSecret);
		expect(JSON.stringify(logLines)).not.toContain(rawSecret);
		expect(setup.app.mocks.queue.getJobsByName("secret-refinement")).toEqual(
			[],
		);
	});

	test("does not expose execution receipts for ordinary idempotent dispatches", async () => {
		const dispatchId = await setup.app.queue.secretDelivery.publish(
			{ rawSecret: "ordinary-payload-for-receipt-scope" },
			{ idempotencyKey: "ordinary-dispatch:v1" },
		);

		expect(await setup.app.queue.getReceipt(dispatchId!)).toBeNull();
	});
});
