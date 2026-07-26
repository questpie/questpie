import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import type { AnyDrizzleClient } from "#questpie/server/config/types.js";

import type { QueueAdapter } from "./adapter.js";
import { questpieQueueDispatchTable } from "./dispatch-table.js";
import type { PublishOptions, QueueDrainResult } from "./types.js";

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_LEASE_MS = 60_000;
const MAX_RELAY_ATTEMPTS = 25;
const MAX_IDEMPOTENCY_KEY_LENGTH = 512;
const MAX_RETRY_DELAY_SECONDS = 3_600;
const SAFE_ADAPTER_PUBLICATION_ERROR = "Adapter publication failed";

type QueueDatabase = AnyDrizzleClient;

export type QueueDispatchRecord =
	typeof questpieQueueDispatchTable.$inferSelect;

export interface QueueDispatchLogger {
	warn?: (message: string, metadata?: Record<string, unknown>) => void;
	error?: (message: string, metadata?: Record<string, unknown>) => void;
}

export async function stableQueueDispatchId(
	jobName: string,
	idempotencyKey?: string,
): Promise<string> {
	if (idempotencyKey === undefined) return crypto.randomUUID();
	if (
		typeof idempotencyKey !== "string" ||
		idempotencyKey.length === 0 ||
		idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH
	) {
		throw new Error(
			`QUESTPIE Queue idempotencyKey must contain between 1 and ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
		);
	}
	const bytes = new Uint8Array(
		await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(
				`questpie-queue-dispatch-v1\u0000${jobName}\u0000${idempotencyKey}`,
			),
		),
	).slice(0, 16);
	bytes[6] = (bytes[6]! & 0x0f) | 0x50;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
	return [
		hex.slice(0, 4).join(""),
		hex.slice(4, 6).join(""),
		hex.slice(6, 8).join(""),
		hex.slice(8, 10).join(""),
		hex.slice(10).join(""),
	].join("-");
}

export async function enqueueQueueDispatch(
	db: QueueDatabase,
	input: {
		dispatchId: string;
		jobName: string;
		idempotencyKey?: string;
		payload: unknown;
		options?: PublishOptions;
	},
): Promise<string> {
	return (await reserveQueueDispatch(db, input)).dispatchId;
}

export async function reserveQueueDispatch(
	db: QueueDatabase,
	input: {
		dispatchId: string;
		jobName: string;
		idempotencyKey?: string;
		payload: unknown;
		options?: PublishOptions;
	},
): Promise<{ dispatchId: string; inserted: boolean }> {
	const inserted = await db
		.insert(questpieQueueDispatchTable)
		.values({
			dispatchId: input.dispatchId,
			jobName: input.jobName,
			idempotencyKey: input.idempotencyKey,
			payload: input.payload,
			options: input.options ?? {},
		})
		.onConflictDoNothing()
		.returning({ dispatchId: questpieQueueDispatchTable.dispatchId });
	if (inserted[0]) {
		return { dispatchId: inserted[0].dispatchId, inserted: true };
	}

	if (input.idempotencyKey) {
		const existing = await db
			.select({ dispatchId: questpieQueueDispatchTable.dispatchId })
			.from(questpieQueueDispatchTable)
			.where(
				and(
					eq(questpieQueueDispatchTable.jobName, input.jobName),
					eq(questpieQueueDispatchTable.idempotencyKey, input.idempotencyKey),
				),
			)
			.limit(1);
		if (existing[0]) {
			return { dispatchId: existing[0].dispatchId, inserted: false };
		}
	}
	throw new Error("QUESTPIE Queue failed to persist dispatch intent");
}

function boundedInteger(
	value: number | undefined,
	fallback: number,
	maximum: number,
): number {
	if (value === undefined) return fallback;
	if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
		throw new Error(`Expected an integer between 1 and ${maximum}`);
	}
	return value;
}

function retryDelaySeconds(attempts: number): number {
	return Math.min(MAX_RETRY_DELAY_SECONDS, 2 ** Math.min(attempts, 12));
}

export async function claimQueueDispatches(
	db: QueueDatabase,
	options: { batchSize?: number; leaseMs?: number; now?: Date } = {},
): Promise<QueueDispatchRecord[]> {
	const batchSize = boundedInteger(
		options.batchSize,
		DEFAULT_BATCH_SIZE,
		1_000,
	);
	const leaseMs = boundedInteger(options.leaseMs, DEFAULT_LEASE_MS, 3_600_000);
	const currentTime = options.now ?? sql`CURRENT_TIMESTAMP`;
	const leasedUntil = options.now
		? new Date(options.now.getTime() + leaseMs)
		: sql`CURRENT_TIMESTAMP + (${leaseMs} * interval '1 millisecond')`;
	const leaseToken = crypto.randomUUID();

	return db.transaction(async (tx) => {
		const available = await tx
			.select({ dispatchId: questpieQueueDispatchTable.dispatchId })
			.from(questpieQueueDispatchTable)
			.where(
				and(
					eq(questpieQueueDispatchTable.status, "pending"),
					lte(questpieQueueDispatchTable.availableAt, currentTime),
					or(
						isNull(questpieQueueDispatchTable.leasedUntil),
						lt(questpieQueueDispatchTable.leasedUntil, currentTime),
					),
				),
			)
			.orderBy(
				asc(questpieQueueDispatchTable.createdAt),
				asc(questpieQueueDispatchTable.dispatchId),
			)
			.limit(batchSize)
			.for("update", { skipLocked: true });
		if (available.length === 0) return [];

		return tx
			.update(questpieQueueDispatchTable)
			.set({
				attempts: sql`${questpieQueueDispatchTable.attempts} + 1`,
				leaseToken,
				leasedUntil,
			})
			.where(
				inArray(
					questpieQueueDispatchTable.dispatchId,
					available.map((row: { dispatchId: string }) => row.dispatchId),
				),
			)
			.returning();
	});
}

async function acceptQueueDispatch(
	db: QueueDatabase,
	task: QueueDispatchRecord,
	adapterJobId: string | null,
	now?: Date,
): Promise<boolean> {
	if (!task.leaseToken) return false;
	const owned = and(
		eq(questpieQueueDispatchTable.dispatchId, task.dispatchId),
		eq(questpieQueueDispatchTable.leaseToken, task.leaseToken),
	);
	if (!task.idempotencyKey) {
		const deleted = await db
			.delete(questpieQueueDispatchTable)
			.where(owned)
			.returning({ dispatchId: questpieQueueDispatchTable.dispatchId });
		return deleted.length === 1;
	}
	const updated = await db
		.update(questpieQueueDispatchTable)
		.set({
			status: "accepted",
			payload: null,
			options: null,
			adapterJobId,
			acceptedAt: now ?? sql`CURRENT_TIMESTAMP`,
			leaseToken: null,
			leasedUntil: null,
			lastError: null,
		})
		.where(owned)
		.returning({ dispatchId: questpieQueueDispatchTable.dispatchId });
	return updated.length === 1;
}

export async function acceptReservedQueueDispatch(
	db: QueueDatabase,
	dispatchId: string,
	adapterJobId: string | null,
): Promise<void> {
	const updated = await db
		.update(questpieQueueDispatchTable)
		.set({
			status: "accepted",
			payload: null,
			options: null,
			adapterJobId,
			acceptedAt: sql`CURRENT_TIMESTAMP`,
			leaseToken: null,
			leasedUntil: null,
			lastError: null,
		})
		.where(
			and(
				eq(questpieQueueDispatchTable.dispatchId, dispatchId),
				eq(questpieQueueDispatchTable.status, "pending"),
			),
		)
		.returning({ dispatchId: questpieQueueDispatchTable.dispatchId });
	if (updated.length !== 1) {
		throw new Error(
			"QUESTPIE Queue failed to persist transactional adapter acceptance",
		);
	}
}

async function retryQueueDispatch(
	db: QueueDatabase,
	task: QueueDispatchRecord,
	now?: Date,
): Promise<"lost" | "retry" | "terminal"> {
	if (!task.leaseToken) return "lost";
	const terminal = task.attempts >= MAX_RELAY_ATTEMPTS;
	const delaySeconds = retryDelaySeconds(task.attempts);
	const updated = await db
		.update(questpieQueueDispatchTable)
		.set({
			status: terminal ? "failed" : "pending",
			availableAt: now
				? new Date(now.getTime() + delaySeconds * 1_000)
				: sql`CURRENT_TIMESTAMP + (${delaySeconds} * interval '1 second')`,
			leaseToken: null,
			leasedUntil: null,
			lastError: SAFE_ADAPTER_PUBLICATION_ERROR,
		})
		.where(
			and(
				eq(questpieQueueDispatchTable.dispatchId, task.dispatchId),
				eq(questpieQueueDispatchTable.leaseToken, task.leaseToken),
			),
		)
		.returning({ dispatchId: questpieQueueDispatchTable.dispatchId });
	if (updated.length !== 1) return "lost";
	return terminal ? "terminal" : "retry";
}

export async function drainQueueDispatches(options: {
	adapter: QueueAdapter;
	batchSize?: number;
	concurrency?: number;
	db: QueueDatabase;
	logger?: QueueDispatchLogger;
	now?: Date;
}): Promise<QueueDrainResult> {
	const batchSize = boundedInteger(
		options.batchSize,
		DEFAULT_BATCH_SIZE,
		1_000,
	);
	const concurrency = boundedInteger(
		options.concurrency,
		DEFAULT_CONCURRENCY,
		32,
	);
	const tasks = await claimQueueDispatches(options.db, {
		batchSize,
		...(options.now ? { now: options.now } : {}),
	});
	let nextIndex = 0;
	let accepted = 0;
	let failed = 0;
	let terminal = 0;

	await Promise.all(
		Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
			while (true) {
				const task = tasks[nextIndex++];
				if (!task) return;
				try {
					const adapterJobId = await options.adapter.publish(
						task.jobName,
						task.payload,
						(task.options ?? undefined) as PublishOptions | undefined,
						task.dispatchId,
					);
					const receiptStored = await acceptQueueDispatch(
						options.db,
						task,
						adapterJobId,
						options.now,
					);
					if (receiptStored) accepted += 1;
				} catch {
					const outcome = await retryQueueDispatch(
						options.db,
						task,
						options.now,
					);
					if (outcome === "lost") continue;
					failed += 1;
					const metadata = {
						dispatchId: task.dispatchId,
						jobName: task.jobName,
						attempts: task.attempts,
						error: SAFE_ADAPTER_PUBLICATION_ERROR,
					};
					if (outcome === "terminal") {
						terminal += 1;
						options.logger?.error?.(
							"[QUESTPIE Queue] Dispatch relay reached terminal failure",
							metadata,
						);
					} else {
						options.logger?.warn?.(
							"[QUESTPIE Queue] Dispatch relay will retry adapter publication",
							metadata,
						);
					}
				}
			}
		}),
	);

	return { claimed: tasks.length, accepted, failed, terminal };
}
