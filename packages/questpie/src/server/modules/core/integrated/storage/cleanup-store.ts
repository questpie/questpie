import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { FilesError, type Files } from "files-sdk";

import {
	questpieStorageCleanupTable,
	questpieStorageObjectKeyTable,
} from "./cleanup-table.js";

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_LEASE_MS = 60_000;
const DELETE_TIMEOUT_MS = 30_000;
const MAX_ERROR_LENGTH = 2_000;
const MAX_LEASE_MS = 36 * 60 * 60 * 1_000;
const MAX_RETRY_DELAY_SECONDS = 3_600;
const WAKE_INTERVAL_MS = 5_000;
const nextWakeAt = new WeakMap<object, number>();

export type StorageCleanupTask =
	typeof questpieStorageCleanupTable.$inferSelect;

export interface DrainStorageCleanupOptions {
	app: any;
	batchSize?: number;
	concurrency?: number;
	db: any;
	logger?: {
		warn?: (message: string, metadata?: Record<string, unknown>) => void;
	};
	now?: Date;
	storage: Files;
}

export async function lockStorageObjectKey(
	db: any,
	key: string,
): Promise<void> {
	await db
		.insert(questpieStorageObjectKeyTable)
		.values({ key })
		.onConflictDoNothing();
	await db
		.select({ key: questpieStorageObjectKeyTable.key })
		.from(questpieStorageObjectKeyTable)
		.where(eq(questpieStorageObjectKeyTable.key, key))
		.for("update");
}

async function hasRetainedStorageReference(
	app: any,
	db: any,
	key: string,
): Promise<boolean> {
	for (const crud of Object.values(app.collections ?? {}) as any[]) {
		if (!crud?.["~internalState"]?.upload) continue;
		const table = crud["~internalRelatedTable"];
		if (!table?.key)
			throw new Error("Upload collection is missing its key column");
		const rows = await db
			.select({ key: table.key })
			.from(table)
			.where(eq(table.key, key))
			.limit(1);
		if (rows.length > 0) return true;
	}
	return false;
}

export interface DrainStorageCleanupResult {
	claimed: number;
	completed: number;
	failed: number;
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

function errorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.slice(0, MAX_ERROR_LENGTH);
}

function isMissingObject(error: unknown): boolean {
	return error instanceof FilesError && error.code === "NotFound";
}

export async function enqueueStorageCleanup(
	db: any,
	key: string,
): Promise<void> {
	await db.insert(questpieStorageCleanupTable).values({ key });
}

/**
 * Delete a provider object only while the key is fenced against reuse and no
 * upload collection retains it. Missing provider objects converge as success.
 */
export async function deleteUnreferencedStorageObject(options: {
	app: any;
	db: any;
	key: string;
	storage: Files;
}): Promise<"deleted" | "retained"> {
	return options.db.transaction(async (tx: any) => {
		await lockStorageObjectKey(tx, options.key);
		if (await hasRetainedStorageReference(options.app, tx, options.key)) {
			return "retained";
		}

		try {
			await options.storage.delete(options.key, {
				timeout: DELETE_TIMEOUT_MS,
			});
		} catch (error) {
			if (!isMissingObject(error)) throw error;
		}
		await tx
			.delete(questpieStorageObjectKeyTable)
			.where(eq(questpieStorageObjectKeyTable.key, options.key));
		return "deleted";
	});
}

/**
 * Best-effort low-latency wake. The outbox row and recurring job are the
 * durability mechanism; this is throttled so a 100k-row retention batch does
 * not publish 100k queue messages.
 */
export function wakeStorageCleanup(
	app: any,
	logger?: DrainStorageCleanupOptions["logger"],
): void {
	if (!app || (typeof app !== "object" && typeof app !== "function")) return;
	const publisher = app.queue?.storageCleanup?.publish;
	if (typeof publisher !== "function") return;

	const now = Date.now();
	if ((nextWakeAt.get(app) ?? 0) > now) return;
	nextWakeAt.set(app, now + WAKE_INTERVAL_MS);

	void publisher
		.call(app.queue.storageCleanup, {}, { singletonKey: "drain" })
		.catch((error: unknown) => {
			logger?.warn?.(
				"[Storage cleanup] Failed to publish a fast-path wake; recurring cleanup retains the durable intent",
				{ error: errorMessage(error) },
			);
		});
}

export async function claimStorageCleanup(
	db: any,
	options: { batchSize?: number; leaseMs?: number; now?: Date } = {},
): Promise<StorageCleanupTask[]> {
	const batchSize = boundedInteger(
		options.batchSize,
		DEFAULT_BATCH_SIZE,
		1_000,
	);
	const leaseMs = boundedInteger(
		options.leaseMs,
		DEFAULT_LEASE_MS,
		MAX_LEASE_MS,
	);
	const currentTime = options.now ?? sql`CURRENT_TIMESTAMP`;
	const leasedUntil = options.now
		? new Date(options.now.getTime() + leaseMs)
		: sql`CURRENT_TIMESTAMP + (${leaseMs} * interval '1 millisecond')`;
	const leaseToken = randomUUID();

	return db.transaction(async (tx: any) => {
		const available = await tx
			.select({ id: questpieStorageCleanupTable.id })
			.from(questpieStorageCleanupTable)
			.where(
				and(
					lte(questpieStorageCleanupTable.availableAt, currentTime),
					or(
						isNull(questpieStorageCleanupTable.leasedUntil),
						lt(questpieStorageCleanupTable.leasedUntil, currentTime),
					),
				),
			)
			.orderBy(
				asc(questpieStorageCleanupTable.createdAt),
				asc(questpieStorageCleanupTable.id),
			)
			.limit(batchSize)
			.for("update", { skipLocked: true });

		if (available.length === 0) return [];

		return tx
			.update(questpieStorageCleanupTable)
			.set({
				attempts: sql`${questpieStorageCleanupTable.attempts} + 1`,
				leasedUntil,
				leaseToken,
			})
			.where(
				inArray(
					questpieStorageCleanupTable.id,
					available.map((row: { id: string }) => row.id),
				),
			)
			.returning();
	});
}

async function acknowledgeStorageCleanup(
	db: any,
	task: StorageCleanupTask,
): Promise<void> {
	if (!task.leaseToken) return;
	await db
		.delete(questpieStorageCleanupTable)
		.where(
			and(
				eq(questpieStorageCleanupTable.id, task.id),
				eq(questpieStorageCleanupTable.leaseToken, task.leaseToken),
			),
		);
}

async function retryStorageCleanup(
	db: any,
	task: StorageCleanupTask,
	error: unknown,
	now?: Date,
): Promise<void> {
	if (!task.leaseToken) return;
	const delaySeconds = retryDelaySeconds(task.attempts);
	await db
		.update(questpieStorageCleanupTable)
		.set({
			availableAt: now
				? new Date(now.getTime() + delaySeconds * 1_000)
				: sql`CURRENT_TIMESTAMP + (${delaySeconds} * interval '1 second')`,
			leasedUntil: null,
			leaseToken: null,
			lastError: errorMessage(error),
		})
		.where(
			and(
				eq(questpieStorageCleanupTable.id, task.id),
				eq(questpieStorageCleanupTable.leaseToken, task.leaseToken),
			),
		);
}

export async function drainStorageCleanup(
	options: DrainStorageCleanupOptions,
): Promise<DrainStorageCleanupResult> {
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
	const leaseMs =
		Math.ceil(batchSize / concurrency) * DELETE_TIMEOUT_MS + DEFAULT_LEASE_MS;
	const tasks = await claimStorageCleanup(options.db, {
		batchSize,
		leaseMs,
		...(options.now ? { now: options.now } : {}),
	});
	let nextIndex = 0;
	let completed = 0;
	let failed = 0;

	const workers = Array.from(
		{ length: Math.min(concurrency, tasks.length) },
		async () => {
			while (true) {
				const task = tasks[nextIndex];
				nextIndex += 1;
				if (!task) return;

				try {
					await deleteUnreferencedStorageObject({
						app: options.app,
						db: options.db,
						key: task.key,
						storage: options.storage,
					});
					await acknowledgeStorageCleanup(options.db, task);
					completed += 1;
				} catch (error) {
					failed += 1;
					await retryStorageCleanup(options.db, task, error, options.now);
					options.logger?.warn?.(
						"[Storage cleanup] Object deletion will be retried",
						{
							attempts: task.attempts,
							key: task.key,
							error: errorMessage(error),
						},
					);
				}
			}
		},
	);
	await Promise.all(workers);

	return { claimed: tasks.length, completed, failed };
}
