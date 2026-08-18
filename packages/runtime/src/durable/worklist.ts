import type { SQL } from "bun";

import type { DurableRunState } from "./postgres-kernel";
import { durableInteger, durableText, type DurableRow } from "./rows";

/**
 * One row of the operator worklist: identities and codes, never a payload.
 *
 * The worklist is a way in, not a way around the inspection projection, so it
 * carries strictly less than `inspect()` and nothing that could hold a result.
 */
export type DurableWorklistEntry = Readonly<{
	runId: string;
	resource: string;
	state: DurableRunState;
	attemptCount: number;
	deadLetter: boolean;
	failureCode: string | null;
	tenantId: string;
	version: number;
}>;

export type DurableWorklistPage = Readonly<{
	runs: readonly DurableWorklistEntry[];
	/**
	 * Whether a further page exists, found by reading one row past the bound.
	 *
	 * Never a total: a count over `durable_runs` is a scan, and a total is also
	 * an existence oracle over rows the caller may not read individually.
	 */
	hasMore: boolean;
}>;

/**
 * Reads the operator worklist.
 *
 * Deliberately not on `DurableKernel`. The kernel is the claim, lease, fence and
 * transition state machine; this is an operator read that changes for different
 * reasons and would grow it past the size the architecture gate allows — which
 * is how the split was found rather than designed.
 *
 * Index-backed by `durable_runs_claim_idx (application_name, state,
 * available_at, run_id)`, so the filter and the order are a prefix scan rather
 * than a sort over the table.
 */
export async function readDurableWorklist(
	input: Readonly<{ sql: SQL; application: string }>,
	request: Readonly<{ state: DurableRunState; first: number }>,
): Promise<DurableWorklistPage> {
	// One past the bound answers hasMore without counting.
	const bound = Math.max(1, Math.min(100, request.first));
	const rows = (await input.sql.unsafe(
		`SELECT run_id::text AS "runId", resource_identity AS "resource", state,
       attempt_count AS "attemptCount", dead_letter AS "deadLetter",
       failure_code AS "failureCode", tenant_id AS "tenantId",
       event_sequence AS "version"
FROM questpie_internal.durable_runs
WHERE application_name = $1 AND state = $2
ORDER BY available_at, run_id
LIMIT $3`,
		[input.application, request.state, bound + 1],
	)) as unknown as readonly DurableRow[];
	return Object.freeze({
		runs: Object.freeze(
			rows.slice(0, bound).map((row) =>
				Object.freeze({
					runId: durableText(row.runId, "run identity"),
					resource: durableText(row.resource, "Resource Identity"),
					state: durableText(row.state, "run state") as DurableRunState,
					attemptCount: durableInteger(row.attemptCount, "attempt count"),
					deadLetter: row.deadLetter === true,
					failureCode:
						row.failureCode === null
							? null
							: durableText(row.failureCode, "failure code"),
					tenantId: durableText(row.tenantId, "tenant identity"),
					version: durableInteger(row.version, "run version"),
				}),
			),
		),
		hasMore: rows.length > bound,
	});
}
