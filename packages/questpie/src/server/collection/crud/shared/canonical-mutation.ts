import type { SQL } from "drizzle-orm";

import { ApiError } from "#questpie/server/errors/index.js";

export const CANONICAL_REVISION_FIELD = "revision";

export type LockedCanonicalRow = Record<string, unknown> & {
	revision?: number;
};

export function assertExpectedRevision(input: {
	enabled: boolean;
	expectedRevision: number | undefined;
	row: LockedCanonicalRow | null;
}): void {
	if (!input.enabled) return;
	const actualRevision = input.row?.revision ?? 0;
	if (
		typeof input.expectedRevision !== "number" ||
		!Number.isFinite(input.expectedRevision) ||
		input.expectedRevision !== actualRevision
	) {
		throw ApiError.conflict("Optimistic concurrency conflict");
	}
}

/**
 * Apply one already-authorized canonical owner-table mutation.
 *
 * The caller owns row locking and the surrounding transaction. This seam owns
 * the invariant that one logical mutation advances the canonical revision at
 * most once. Passing `expectedRevision: "internal"` is reserved for
 * transaction-internal writers (for example CRDT projection) that already hold
 * the owner lock.
 */
export async function mutateCanonicalRow(input: {
	transaction: any;
	table: any;
	where: SQL | undefined;
	lockedRow: LockedCanonicalRow;
	values: Record<string, unknown>;
	optimisticConcurrency: boolean;
	expectedRevision: number | "internal" | undefined;
}): Promise<LockedCanonicalRow> {
	if (input.optimisticConcurrency && input.expectedRevision !== "internal") {
		assertExpectedRevision({
			enabled: true,
			expectedRevision: input.expectedRevision,
			row: input.lockedRow,
		});
	}
	const revisionColumn = input.table[CANONICAL_REVISION_FIELD];
	if (input.optimisticConcurrency && !revisionColumn) {
		throw new Error("Canonical revision column is unavailable");
	}
	const [written] = await input.transaction
		.update(input.table)
		.set({
			...input.values,
			...(input.optimisticConcurrency
				? {
						[CANONICAL_REVISION_FIELD]: input.lockedRow.revision! + 1,
					}
				: {}),
		})
		.where(input.where)
		.returning();
	if (!written) throw new Error("Canonical owner write failed");
	return written as LockedCanonicalRow;
}
