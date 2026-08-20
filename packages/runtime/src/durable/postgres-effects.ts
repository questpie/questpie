import type { SQL } from "bun";

import { canonicalMutationBytes, mutationDigest } from "../mutation/canonical";
import type { DurableClaim } from "./rows";
import {
	appendDurableRunEvent,
	durableText,
	effectIdentity,
	leaseTokenDigest,
	markDurableKernelTransaction,
	type DurableQuery,
	type DurableRow,
} from "./rows";

export type DurableEffectStatus =
	| "acknowledged"
	| "ambiguous"
	| "pending"
	| "succeeded";

export type DurableEffectReservation =
	| Readonly<{ status: "reserved"; effectId: string }>
	| Readonly<{ status: "recovered"; effectId: string; receipt: string }>
	| Readonly<{ status: "conflict"; effectId: string }>
	| Readonly<{ status: "fenced" }>;

export type DurableEffectView = Readonly<{
	effectName: string;
	effectId: string;
	status: DurableEffectStatus;
	receipt: string | null;
}>;

/**
 * A lost provider response has no safe automatic answer. QUESTPIE keeps one
 * stable effect identity for one logical effect across every attempt so a
 * provider idempotency receipt can recover it, and records `ambiguous`
 * otherwise. It does not claim exactly-once effects.
 */
export interface DurableEffectLedger {
	reserve(
		claim: DurableClaim,
		input: Readonly<{ effectName: string; input: unknown }>,
	): Promise<DurableEffectReservation>;
	settle(
		claim: DurableClaim,
		input: Readonly<{ effectName: string; receipt: string }>,
	): Promise<"applied" | "fenced">;
	markAmbiguous(
		claim: DurableClaim,
		input: Readonly<{ effectName: string }>,
	): Promise<"applied" | "fenced">;
	read(runId: string): Promise<readonly DurableEffectView[]>;
}

function effectView(row: DurableRow): DurableEffectView {
	return Object.freeze({
		effectName: durableText(row.effectName, "effect name"),
		effectId: durableText(row.effectId, "effect identity"),
		status: durableText(row.status, "effect status") as DurableEffectStatus,
		receipt:
			row.receipt === null ? null : durableText(row.receipt, "effect receipt"),
	});
}

export function createPostgresDurableEffectLedger(
	input: Readonly<{ sql: SQL; application: string }>,
): DurableEffectLedger {
	const transaction = <Result>(
		use: (query: DurableQuery) => Promise<Result>,
	): Promise<Result> =>
		input.sql.begin(async (session) => {
			const query: DurableQuery = (statement, parameters = []) =>
				session.unsafe(statement, [...parameters]) as unknown as Promise<
					readonly DurableRow[]
				>;
			await markDurableKernelTransaction(query);
			return use(query);
		}) as Promise<Result>;

	const fenced = async (
		query: DurableQuery,
		claim: DurableClaim,
	): Promise<boolean> => {
		const rows = await query(
			`SELECT 1 AS held FROM questpie_internal.durable_runs
WHERE application_name = $1 AND run_id = $2
  AND current_attempt_id = $3 AND lease_token_digest = $4`,
			[
				input.application,
				claim.runId,
				claim.attemptId,
				leaseTokenDigest(claim.leaseToken),
			],
		);
		return rows.length === 0;
	};

	return Object.freeze<DurableEffectLedger>({
		async reserve(claim, request) {
			const effectId = effectIdentity(
				input.application,
				claim.runId,
				request.effectName,
			);
			const inputDigest = mutationDigest(
				canonicalMutationBytes(request.input ?? null),
			);
			return transaction(async (query): Promise<DurableEffectReservation> => {
				if (await fenced(query, claim))
					return Object.freeze({ status: "fenced" as const });
				await query(
					`INSERT INTO questpie_internal.durable_effects
  (application_name, run_id, effect_name, effect_id, input_digest, status,
   reserved_attempt_id, reserved_at)
VALUES ($1, $2, $3, $4, $5, 'pending', $6, pg_catalog.transaction_timestamp())
ON CONFLICT DO NOTHING`,
					[
						input.application,
						claim.runId,
						request.effectName,
						effectId,
						inputDigest,
						claim.attemptId,
					],
				);
				const [row] = await query(
					`SELECT status, receipt, input_digest AS "inputDigest"
FROM questpie_internal.durable_effects
WHERE application_name = $1 AND run_id = $2 AND effect_name = $3`,
					[input.application, claim.runId, request.effectName],
				);
				if (!row) throw new TypeError("durable effect reservation is missing");
				if (durableText(row.inputDigest, "effect input digest") !== inputDigest)
					return Object.freeze({ status: "conflict" as const, effectId });
				const status = durableText(row.status, "effect status");
				if (status === "succeeded")
					return Object.freeze({
						status: "recovered" as const,
						effectId,
						receipt: durableText(row.receipt, "effect receipt"),
					});
				return Object.freeze({ status: "reserved" as const, effectId });
			});
		},
		async settle(claim, request) {
			return transaction(async (query) => {
				if (await fenced(query, claim)) return "fenced" as const;
				const settled = await query(
					`UPDATE questpie_internal.durable_effects
SET status = 'succeeded', receipt = $4, settled_attempt_id = $5,
    settled_at = pg_catalog.transaction_timestamp()
WHERE application_name = $1 AND run_id = $2 AND effect_name = $3
  AND status IN ('ambiguous', 'pending')
RETURNING effect_id`,
					[
						input.application,
						claim.runId,
						request.effectName,
						request.receipt,
						claim.attemptId,
					],
				);
				if (settled.length > 0)
					await appendDurableRunEvent(query, {
						application: input.application,
						claim,
						kind: "effectSettled",
					});
				return "applied" as const;
			});
		},
		async markAmbiguous(claim, request) {
			return transaction(async (query) => {
				if (await fenced(query, claim)) return "fenced" as const;
				const ambiguous = await query(
					`UPDATE questpie_internal.durable_effects
SET status = 'ambiguous'
WHERE application_name = $1 AND run_id = $2 AND effect_name = $3 AND status = 'pending'
RETURNING effect_id`,
					[input.application, claim.runId, request.effectName],
				);
				if (ambiguous.length > 0)
					await appendDurableRunEvent(query, {
						application: input.application,
						claim,
						kind: "effectAmbiguous",
					});
				return "applied" as const;
			});
		},
		async read(runId) {
			const rows = (await input.sql.unsafe(
				`SELECT effect_name AS "effectName", effect_id::text AS "effectId",
       status, receipt
FROM questpie_internal.durable_effects
WHERE application_name = $1 AND run_id = $2
ORDER BY effect_name`,
				[input.application, runId],
			)) as unknown as readonly DurableRow[];
			return Object.freeze(rows.map(effectView));
		},
	});
}
