import { Buffer } from "node:buffer";

import { and, eq, gt, isNull, sql } from "drizzle-orm";

import type { AnyDrizzleClient } from "#questpie/server/config/types.js";

import type { CoreNoticeRouter } from "../collaboration/notice-router.js";
import { crdtAggregateHash } from "./notice.js";
import {
	questpieCrdtBindingTable,
	questpieCrdtSessionGrantTable,
	questpieCrdtSessionTable,
} from "./schema.js";

type CrdtDatabase = AnyDrizzleClient<any>;

export class CrdtRealtimeBindingRejectedError extends Error {
	constructor() {
		super("CRDT realtime binding unavailable");
		this.name = "CrdtRealtimeBindingRejectedError";
	}
}

export function createCrdtRealtimeBindingSource(input: {
	db: CrdtDatabase;
	namespace: string;
	noticeRouter: Pick<CoreNoticeRouter, "subscribe">;
}) {
	const assertBinding = async (options: {
		bindingId: string;
		edgeSessionKey: Uint8Array;
		edgeOwnerGeneration: bigint;
	}) => {
		if (
			!isUuid(options.bindingId) ||
			options.edgeSessionKey.byteLength !== 32 ||
			options.edgeOwnerGeneration < 0n
		) {
			throw new CrdtRealtimeBindingRejectedError();
		}
		const rows = await readBinding(input.db, options);
		if (rows.length === 0) throw new CrdtRealtimeBindingRejectedError();
		return rows;
	};
	return Object.freeze({
		async assert(options: {
			bindingId: string;
			edgeSessionKey: Uint8Array;
			edgeOwnerGeneration: bigint;
		}): Promise<void> {
			await assertBinding(options);
		},
		async subscribe(options: {
			bindingId: string;
			edgeSessionKey: Uint8Array;
			edgeOwnerGeneration: bigint;
			signal: AbortSignal;
			onDirty(): void | Promise<void>;
			onError?(error: unknown): void;
		}): Promise<() => Promise<void>> {
			if (options.signal.aborted) {
				throw new CrdtRealtimeBindingRejectedError();
			}
			const rows = await assertBinding({
				bindingId: options.bindingId,
				edgeSessionKey: options.edgeSessionKey,
				edgeOwnerGeneration: options.edgeOwnerGeneration,
			});
			const aggregateHash = crdtAggregateHash({
				namespace: input.namespace,
				resourceId: rows[0]!.resourceId,
				resourceEpochId: rows[0]!.resourceEpochId,
			});
			let visibleCut = visibleCutFingerprint(rows);
			let active = true;
			let reconcilePending = false;
			const requestReconcile = () => {
				if (reconcilePending || !active || options.signal.aborted) return;
				reconcilePending = true;
				queueMicrotask(() => {
					if (!active || options.signal.aborted) {
						reconcilePending = false;
						return;
					}
					void Promise.resolve(options.onDirty())
						.catch((error) => options.onError?.(error))
						.finally(() => {
							reconcilePending = false;
						});
				});
			};
			const releaseNotice = await input.noticeRouter.subscribe({
				kind: "crdt",
				routingKey: aggregateHash,
				onNotice: async (notice) => {
					if (
						!active ||
						options.signal.aborted ||
						notice.wake.aggregateHash !== aggregateHash
					) {
						return;
					}
					const current = await readBinding(input.db, {
						bindingId: options.bindingId,
						edgeSessionKey: options.edgeSessionKey,
						edgeOwnerGeneration: options.edgeOwnerGeneration,
					});
					if (!active || options.signal.aborted) return;
					if (current.length === 0) {
						throw new CrdtRealtimeBindingRejectedError();
					}
					if (notice.wake.lane !== "awareness") {
						const nextVisibleCut = visibleCutFingerprint(current);
						if (nextVisibleCut === visibleCut) return;
						visibleCut = nextVisibleCut;
					}
					await options.onDirty();
				},
				onError: options.onError,
				onOverflow: requestReconcile,
				onStateChange: (state) => {
					if (state === "connected") requestReconcile();
				},
			});
			const abort = () => {
				active = false;
				void releaseNotice();
			};
			options.signal.addEventListener("abort", abort, { once: true });
			let released = false;
			return async () => {
				if (released) return;
				released = true;
				active = false;
				options.signal.removeEventListener("abort", abort);
				await releaseNotice();
			};
		},
	});
}

function visibleCutFingerprint(
	rows: readonly Readonly<{
		fieldSlot: number;
		headFieldCursor: bigint;
	}>[],
): string {
	return rows
		.map((row) => `${row.fieldSlot}:${row.headFieldCursor.toString()}`)
		.join(",");
}

async function readBinding(
	db: CrdtDatabase,
	input: {
		bindingId: string;
		edgeSessionKey: Uint8Array;
		edgeOwnerGeneration: bigint;
	},
) {
	return db
		.select({
			resourceId: questpieCrdtSessionTable.resourceId,
			resourceEpochId: questpieCrdtSessionTable.resourceEpochId,
			fieldSlot: questpieCrdtSessionGrantTable.fieldSlot,
			headFieldCursor: questpieCrdtBindingTable.headFieldCursor,
		})
		.from(questpieCrdtSessionTable)
		.innerJoin(
			questpieCrdtSessionGrantTable,
			eq(questpieCrdtSessionGrantTable.sessionId, questpieCrdtSessionTable.id),
		)
		.innerJoin(
			questpieCrdtBindingTable,
			eq(questpieCrdtBindingTable.id, questpieCrdtSessionGrantTable.bindingId),
		)
		.where(
			and(
				eq(questpieCrdtSessionTable.bindingId, input.bindingId),
				eq(
					questpieCrdtSessionTable.edgeSessionKey,
					Buffer.from(input.edgeSessionKey),
				),
				eq(
					questpieCrdtSessionTable.edgeOwnerGeneration,
					input.edgeOwnerGeneration,
				),
				isNull(questpieCrdtSessionTable.closedAt),
				gt(questpieCrdtSessionTable.leaseExpiresAt, sql`clock_timestamp()`),
				gt(questpieCrdtSessionTable.authorityExpiresAt, sql`clock_timestamp()`),
				eq(questpieCrdtBindingTable.status, 1),
				isNull(questpieCrdtBindingTable.retiredAt),
				eq(
					questpieCrdtBindingTable.fieldEpoch,
					questpieCrdtSessionGrantTable.fieldEpoch,
				),
				eq(
					questpieCrdtBindingTable.formatVersion,
					questpieCrdtSessionGrantTable.formatVersion,
				),
				eq(
					questpieCrdtBindingTable.readFence,
					questpieCrdtSessionGrantTable.fieldReadFence,
				),
			),
		)
		.orderBy(questpieCrdtSessionGrantTable.fieldSlot);
}

function isUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
		value,
	);
}
