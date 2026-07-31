import {
	and,
	asc,
	desc,
	eq,
	gt,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	or,
	sql,
} from "drizzle-orm";

import type { AnyDrizzleClient } from "#questpie/server/config/types.js";

import type { QueueAdapter } from "./adapter.js";
import { questpieQueueDispatchTable } from "./dispatch-table.js";
import type { QueueWrappedSecretKey } from "./secret-payload.js";
import type {
	PublishOptions,
	QueueDispatchReceipt,
	QueueDrainResult,
} from "./types.js";

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_LEASE_MS = 60_000;
const MAX_RELAY_ATTEMPTS = 25;
const MAX_IDEMPOTENCY_KEY_LENGTH = 512;
const MAX_RETRY_DELAY_SECONDS = 3_600;
const SAFE_ADAPTER_PUBLICATION_ERROR = "Adapter publication failed";
const DEFAULT_EXECUTION_LEASE_MS = 60_000;

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
		wrappedSecretKey?: QueueWrappedSecretKey;
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
		wrappedSecretKey?: QueueWrappedSecretKey;
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
			secretPayload: input.options?.secretPayload === true,
			wrappedSecretKey: input.wrappedSecretKey,
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

export type QueueExecutionClaim =
	| {
			status: "claimed";
			token: string;
			wrappedKey: QueueWrappedSecretKey;
	  }
	| { status: "busy" | "terminal" | "unavailable" };

export async function claimQueueDispatchExecution(
	db: QueueDatabase,
	dispatchId: string,
	options: { leaseMs?: number; now?: Date } = {},
): Promise<QueueExecutionClaim> {
	const leaseMs = boundedInteger(
		options.leaseMs,
		DEFAULT_EXECUTION_LEASE_MS,
		3_600_000,
	);
	const currentTime = options.now ?? sql`CURRENT_TIMESTAMP`;
	const claimedUntil = options.now
		? new Date(options.now.getTime() + leaseMs)
		: sql`CURRENT_TIMESTAMP + (${leaseMs} * interval '1 millisecond')`;
	const token = crypto.randomUUID();
	const claimed = await db
		.update(questpieQueueDispatchTable)
		.set({
			executionClaimToken: token,
			executionClaimedUntil: claimedUntil,
		})
		.where(
			and(
				eq(questpieQueueDispatchTable.dispatchId, dispatchId),
				eq(questpieQueueDispatchTable.secretPayload, true),
				eq(questpieQueueDispatchTable.status, "accepted"),
				isNotNull(questpieQueueDispatchTable.wrappedSecretKey),
				or(
					isNull(questpieQueueDispatchTable.executionClaimToken),
					isNull(questpieQueueDispatchTable.executionClaimedUntil),
					lt(questpieQueueDispatchTable.executionClaimedUntil, currentTime),
				),
			),
		)
		.returning({
			wrappedSecretKey: questpieQueueDispatchTable.wrappedSecretKey,
		});
	if (claimed[0]?.wrappedSecretKey) {
		return {
			status: "claimed",
			token,
			wrappedKey: claimed[0].wrappedSecretKey as QueueWrappedSecretKey,
		};
	}

	const [existing] = await db
		.select({
			status: questpieQueueDispatchTable.status,
			secretPayload: questpieQueueDispatchTable.secretPayload,
			executionClaimToken: questpieQueueDispatchTable.executionClaimToken,
			executionClaimedUntil: questpieQueueDispatchTable.executionClaimedUntil,
		})
		.from(questpieQueueDispatchTable)
		.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId))
		.limit(1);
	if (!existing || !existing.secretPayload) return { status: "unavailable" };
	if (existing.status === "completed" || existing.status === "failed") {
		return { status: "terminal" };
	}
	if (
		existing.status === "accepted" &&
		existing.executionClaimToken &&
		existing.executionClaimedUntil &&
		existing.executionClaimedUntil.getTime() >
			(options.now?.getTime() ?? Date.now())
	) {
		return { status: "busy" };
	}
	return { status: "unavailable" };
}

export async function renewQueueDispatchExecution(
	db: QueueDatabase,
	dispatchId: string,
	token: string,
	options: { leaseMs?: number } = {},
): Promise<boolean> {
	const leaseMs = boundedInteger(
		options.leaseMs,
		DEFAULT_EXECUTION_LEASE_MS,
		3_600_000,
	);
	const updated = await db
		.update(questpieQueueDispatchTable)
		.set({
			executionClaimedUntil: sql`CURRENT_TIMESTAMP + (${leaseMs} * interval '1 millisecond')`,
		})
		.where(
			and(
				eq(questpieQueueDispatchTable.dispatchId, dispatchId),
				eq(questpieQueueDispatchTable.status, "accepted"),
				eq(questpieQueueDispatchTable.executionClaimToken, token),
			),
		)
		.returning({ dispatchId: questpieQueueDispatchTable.dispatchId });
	return updated.length === 1;
}

export async function releaseQueueDispatchExecution(
	db: QueueDatabase,
	dispatchId: string,
	token: string,
): Promise<void> {
	await db
		.update(questpieQueueDispatchTable)
		.set({
			executionClaimToken: null,
			executionClaimedUntil: null,
		})
		.where(
			and(
				eq(questpieQueueDispatchTable.dispatchId, dispatchId),
				eq(questpieQueueDispatchTable.status, "accepted"),
				eq(questpieQueueDispatchTable.executionClaimToken, token),
			),
		);
}

export async function getQueueDispatchReceipt(
	db: QueueDatabase,
	dispatchId: string,
): Promise<QueueDispatchReceipt | null> {
	const [record] = await db
		.select({
			dispatchId: questpieQueueDispatchTable.dispatchId,
			jobName: questpieQueueDispatchTable.jobName,
			idempotencyKey: questpieQueueDispatchTable.idempotencyKey,
			status: questpieQueueDispatchTable.status,
			createdAt: questpieQueueDispatchTable.createdAt,
			acceptedAt: questpieQueueDispatchTable.acceptedAt,
			completedAt: questpieQueueDispatchTable.completedAt,
			failedAt: questpieQueueDispatchTable.failedAt,
			secretPayload: questpieQueueDispatchTable.secretPayload,
		})
		.from(questpieQueueDispatchTable)
		.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId))
		.limit(1);
	if (!record) return null;
	if (!record.secretPayload) return null;
	return {
		dispatchId: record.dispatchId,
		jobName: record.jobName,
		...(record.idempotencyKey ? { idempotencyKey: record.idempotencyKey } : {}),
		status:
			record.status === "completed"
				? "completed"
				: record.status === "failed"
					? "failed"
					: "queued",
		createdAt: record.createdAt,
		queuedAt: record.acceptedAt,
		handledAt: record.completedAt ?? record.failedAt,
	};
}

export async function completeQueueDispatch(
	db: QueueDatabase,
	dispatchId: string,
): Promise<void> {
	const updated = await db
		.update(questpieQueueDispatchTable)
		.set({
			status: "completed",
			payload: null,
			options: null,
			wrappedSecretKey: null,
			executionClaimToken: null,
			executionClaimedUntil: null,
			completedAt: sql`CURRENT_TIMESTAMP`,
			failedAt: null,
			lastError: null,
		})
		.where(
			and(
				eq(questpieQueueDispatchTable.dispatchId, dispatchId),
				eq(questpieQueueDispatchTable.secretPayload, true),
				inArray(questpieQueueDispatchTable.status, ["accepted", "failed"]),
			),
		)
		.returning({ dispatchId: questpieQueueDispatchTable.dispatchId });
	if (updated.length === 1) return;
	const [existing] = await db
		.select({ status: questpieQueueDispatchTable.status })
		.from(questpieQueueDispatchTable)
		.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId))
		.limit(1);
	if (existing?.status !== "completed") {
		throw new Error("QUESTPIE Queue failed to persist handler completion");
	}
}

export async function failQueueDispatch(
	db: QueueDatabase,
	dispatchId: string,
	options: { now?: Date } = {},
): Promise<boolean> {
	const currentTime = options.now ?? sql`CURRENT_TIMESTAMP`;
	const updated = await db
		.update(questpieQueueDispatchTable)
		.set({
			status: "failed",
			payload: null,
			options: null,
			wrappedSecretKey: null,
			failedAt: sql`CURRENT_TIMESTAMP`,
			lastError: "Job handling failed",
		})
		.where(
			and(
				eq(questpieQueueDispatchTable.dispatchId, dispatchId),
				eq(questpieQueueDispatchTable.secretPayload, true),
				eq(questpieQueueDispatchTable.status, "accepted"),
				or(
					isNull(questpieQueueDispatchTable.executionClaimToken),
					isNull(questpieQueueDispatchTable.executionClaimedUntil),
					lte(questpieQueueDispatchTable.executionClaimedUntil, currentTime),
				),
			),
		)
		.returning({ dispatchId: questpieQueueDispatchTable.dispatchId });
	if (updated.length === 1) return true;
	const [existing] = await db
		.select({ status: questpieQueueDispatchTable.status })
		.from(questpieQueueDispatchTable)
		.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId))
		.limit(1);
	if (!existing) {
		throw new Error(
			"QUESTPIE Queue failed to persist terminal handler failure",
		);
	}
	return false;
}

export async function reconcileQueueDispatchExecutions(options: {
	adapter: QueueAdapter;
	db: QueueDatabase;
	batchSize?: number;
	logger?: QueueDispatchLogger;
	now?: Date;
}): Promise<{ inspected: number; terminal: number }> {
	if (
		options.adapter.capabilities?.executionTerminalState !== true ||
		typeof options.adapter.inspectExecutionState !== "function"
	) {
		return { inspected: 0, terminal: 0 };
	}
	const batchSize = boundedInteger(
		options.batchSize,
		DEFAULT_BATCH_SIZE,
		1_000,
	);
	const eligible = and(
		eq(questpieQueueDispatchTable.secretPayload, true),
		eq(questpieQueueDispatchTable.status, "accepted"),
		isNotNull(questpieQueueDispatchTable.adapterJobId),
	);
	const [highWater] = await options.db
		.select({
			createdAt: questpieQueueDispatchTable.createdAt,
			dispatchId: questpieQueueDispatchTable.dispatchId,
		})
		.from(questpieQueueDispatchTable)
		.where(eligible)
		.orderBy(
			desc(questpieQueueDispatchTable.createdAt),
			desc(questpieQueueDispatchTable.dispatchId),
		)
		.limit(1);
	if (!highWater) return { inspected: 0, terminal: 0 };

	let cursor:
		| {
				createdAt: Date;
				dispatchId: string;
		  }
		| undefined;
	let inspected = 0;
	let terminal = 0;
	while (true) {
		const records = await options.db
			.select({
				dispatchId: questpieQueueDispatchTable.dispatchId,
				jobName: questpieQueueDispatchTable.jobName,
				adapterJobId: questpieQueueDispatchTable.adapterJobId,
				createdAt: questpieQueueDispatchTable.createdAt,
			})
			.from(questpieQueueDispatchTable)
			.where(
				and(
					eligible,
					or(
						lt(questpieQueueDispatchTable.createdAt, highWater.createdAt),
						and(
							eq(questpieQueueDispatchTable.createdAt, highWater.createdAt),
							lte(questpieQueueDispatchTable.dispatchId, highWater.dispatchId),
						),
					),
					cursor
						? or(
								gt(questpieQueueDispatchTable.createdAt, cursor.createdAt),
								and(
									eq(questpieQueueDispatchTable.createdAt, cursor.createdAt),
									gt(questpieQueueDispatchTable.dispatchId, cursor.dispatchId),
								),
							)
						: undefined,
				),
			)
			.orderBy(
				asc(questpieQueueDispatchTable.createdAt),
				asc(questpieQueueDispatchTable.dispatchId),
			)
			.limit(batchSize);
		if (records.length === 0) break;
		inspected += records.length;
		for (const record of records) {
			if (!record.adapterJobId) continue;
			let brokerState;
			try {
				brokerState = await options.adapter.inspectExecutionState(
					record.jobName,
					record.adapterJobId,
				);
			} catch {
				options.logger?.warn?.(
					"[QUESTPIE Queue] Broker execution reconciliation failed",
					{
						dispatchId: record.dispatchId,
						jobName: record.jobName,
					},
				);
				continue;
			}
			if (
				brokerState !== "failed" &&
				brokerState !== "missing" &&
				brokerState !== "completed"
			) {
				continue;
			}
			if (
				await failQueueDispatch(
					options.db,
					record.dispatchId,
					options.now === undefined ? {} : { now: options.now },
				)
			) {
				terminal += 1;
			}
		}
		const last = records.at(-1)!;
		cursor = {
			createdAt: last.createdAt,
			dispatchId: last.dispatchId,
		};
		if (records.length < batchSize) break;
	}
	return { inspected, terminal };
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
			...(terminal
				? {
						failedAt: now ?? sql`CURRENT_TIMESTAMP`,
						...(task.wrappedSecretKey
							? {
									payload: null,
									options: null,
									wrappedSecretKey: null,
								}
							: {}),
					}
				: {}),
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
