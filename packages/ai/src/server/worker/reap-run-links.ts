import { sql } from "drizzle-orm";

import { finalizeRun, type FinalizeRunDeps } from "./finalize-run.js";

const ACTIVE_STATUSES = ["claimed", "running"];

export interface ReapRunLinksDeps extends FinalizeRunDeps {
	collections: FinalizeRunDeps["collections"] & {
		run_links: FinalizeRunDeps["collections"]["run_links"] & {
			find(args: {
				where: unknown;
				limit?: number;
			}): Promise<{ docs: Array<Record<string, unknown>> }>;
		};
	};
}

/**
 * The orphan reaper (§3.8 mech.2). Any `run_links` row in `claimed`/`running`
 * whose `producerLease.expiresAt < now` is reaped per its `retryPolicy`:
 *
 * - `auto` → requeue to `pending`, bump `producerLease.epoch` (fences the zombie
 *   holding the old epoch AND preserves the never-goes-backwards invariant),
 *   clear the worker; do NOT finalize.
 * - `none` (default, and always for `kind:'task'` — the workflow owns retry) →
 *   `finalizeRun({terminal:'failed'})`, which appends a real error+finish chunk,
 *   seals the stream, and emits `run.completed{failed}` once (latch).
 *
 * Never touches `pending` rows (§3.8:162). The finalize/requeue CAS is epoch-
 * guarded, so a row a live worker just re-claimed (new epoch) is left alone.
 * The 5-minute cron is the background sweep; interactive runs are bounded tighter
 * by the stream tail's inline liveness (§3.8 mech.3, T6).
 */
export async function reapExpiredRunLinks(
	deps: ReapRunLinksDeps,
	now = new Date(),
): Promise<{ reapedFailed: number; reapedRequeued: number }> {
	const result = await deps.collections.run_links.find({
		where: { status: { in: ACTIVE_STATUSES } },
		limit: 500,
	});

	let reapedFailed = 0;
	let reapedRequeued = 0;

	for (const row of result.docs) {
		const lease =
			row.producerLease && typeof row.producerLease === "object"
				? (row.producerLease as Record<string, unknown>)
				: null;
		const epoch = typeof lease?.epoch === "number" ? lease.epoch : null;
		const expiresAt =
			typeof lease?.expiresAt === "string" ? lease.expiresAt : null;
		// Skip rows without a fence-able lease or whose lease has not expired.
		if (
			epoch == null ||
			!expiresAt ||
			new Date(expiresAt).getTime() >= now.getTime()
		) {
			continue;
		}

		if (row.retryPolicy === "auto") {
			const updated = await deps.collections.run_links.update({
				where: {
					id: row.id,
					status: { in: ACTIVE_STATUSES },
					// json values are stored double-encoded (jsonb string) by the
					// collection layer — peel with `#>> '{}'` (also matches objects).
					RAW: ({ table }: { table: Record<string, unknown> }) =>
						sql`((${table.producerLease} #>> '{}')::jsonb ->> 'epoch')::int = ${epoch}`,
				},
				data: {
					status: "pending",
					worker: null,
					producerLease: { epoch: epoch + 1 },
				},
			});
			if (Array.isArray(updated) && updated.length > 0) reapedRequeued++;
			continue;
		}

		const { finalized } = await finalizeRun(deps, {
			runId: row.id as string,
			kind: typeof row.kind === "string" ? row.kind : null,
			terminal: "failed",
			epoch,
			error: "worker lease expired",
			activeStreamId:
				typeof row.activeStreamId === "string" ? row.activeStreamId : undefined,
		});
		if (finalized) reapedFailed++;
	}

	return { reapedFailed, reapedRequeued };
}
