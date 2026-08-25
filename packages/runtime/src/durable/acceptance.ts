import { deterministicUuid } from "../mutation/canonical";
import type { LinkedReactionMember } from "./projection";
import {
	durableText,
	markDurableKernelTransaction,
	retryBytes,
	type DurableActor,
	type DurableQuery,
} from "./rows";

export type DurableAcceptance = Readonly<{
	dispatchId: string;
	runId: string;
	resource: string;
}>;

/** One acceptance fact owns one run; the dispatch identity derives both. */
export function durableRunIdentity(dispatchId: string): string {
	return deterministicUuid(
		new TextEncoder().encode(`questpie.durable-run\u0000${dispatchId}`),
	);
}

/**
 * Advances one recorded dispatch into a ready run inside the caller's
 * transaction. `durable_run_dispatch_unique` makes a second run for the same
 * committed fact unrepresentable rather than merely unlikely.
 */
export async function acceptDurableDispatch(
	input: Readonly<{
		query: DurableQuery;
		application: string;
		dispatchId: string;
		reaction: LinkedReactionMember;
		tenantId: string;
		principal: DurableActor;
		contextInputBytes: Uint8Array;
		payloadBytes: Uint8Array;
		runtimeBuildDigest: string;
		causationId: string;
		correlationId: string;
		acceptedAt: Date;
	}>,
): Promise<DurableAcceptance | null> {
	await markDurableKernelTransaction(input.query);
	const advanced = await input.query(
		`UPDATE questpie_internal.durable_dispatches
SET state = 'accepted'
WHERE application_name = $1 AND record_id = $2 AND state = 'pending'
RETURNING record_id::text AS "dispatchId"`,
		[input.application, input.dispatchId],
	);
	if (advanced.length === 0) return null;
	const runId = durableRunIdentity(input.dispatchId);
	const horizonAt = new Date(
		input.acceptedAt.getTime() + input.reaction.retry.horizonMilliseconds,
	);
	const inserted = await input.query(
		`INSERT INTO questpie_internal.durable_runs
  (application_name, run_id, dispatch_id, resource_identity, semantic_version, tenant_id, principal_kind, principal_id,
   run_as, context_input_bytes, payload_bytes, retry_bytes, runtime_build_digest, executable_digest,
   causation_kind, causation_id, correlation_id, state, attempt_count, available_at, horizon_at,
   cancellation_requested, event_sequence, dead_letter, accepted_at)
VALUES ($1, $2, $3, $4, 1, $5, $6, $7, 'caller', $8, $9, $10, $11, $12,
   'mutationDispatch', $13, $14, 'ready', 0, $15, $16, false, 1, false, $15)
ON CONFLICT DO NOTHING
RETURNING run_id::text AS "runId"`,
		[
			input.application,
			runId,
			input.dispatchId,
			input.reaction.identity,
			input.tenantId,
			input.principal.kind,
			input.principal.id,
			input.contextInputBytes,
			input.payloadBytes,
			retryBytes(input.reaction.retry),
			input.runtimeBuildDigest,
			input.reaction.contractDigest,
			input.causationId,
			input.correlationId,
			input.acceptedAt,
			horizonAt,
		],
	);
	if (inserted.length === 0) return null;
	await input.query(
		`INSERT INTO questpie_internal.durable_run_events
  (application_name, run_id, sequence, occurred_at, resource_identity, dispatch_id,
   causation_id, correlation_id, kind)
VALUES ($1, $2, 1, $3, $4, $5, $6, $7, 'accepted')`,
		[
			input.application,
			runId,
			input.acceptedAt,
			input.reaction.identity,
			input.dispatchId,
			input.causationId,
			input.correlationId,
		],
	);
	return Object.freeze({
		dispatchId: durableText(advanced[0]!.dispatchId, "dispatch identity"),
		runId,
		resource: input.reaction.identity,
	});
}
