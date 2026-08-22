import type { PostgresTransaction } from "../postgres/contract";
import {
	durableEventInsert,
	durableEventSequenceBump,
	type DurableEventErrorCode,
	type DurableEventKind,
} from "./postgres-statements";
import { leaseTokenDigest, type DurableEventClaim } from "./rows";

export async function appendPostgresDatabaseDurableRunEvent(
	transaction: PostgresTransaction,
	input: Readonly<{
		application: string;
		claim: DurableEventClaim;
		kind: DurableEventKind;
		errorCode?: DurableEventErrorCode | null;
	}>,
): Promise<void> {
	const bumped = await transaction.execute(durableEventSequenceBump, {
		application: input.application,
		runId: input.claim.runId,
	});
	if (!bumped) throw new TypeError("Durable run history has no run");
	await transaction.execute(durableEventInsert, {
		application: input.application,
		runId: input.claim.runId,
		sequence: bumped.sequence,
		resource: input.claim.resource,
		dispatchId: input.claim.dispatchId,
		attemptId: input.claim.attemptId,
		leaseTokenDigest:
			input.claim.leaseToken === null
				? null
				: leaseTokenDigest(input.claim.leaseToken),
		causationId: input.claim.causationId,
		correlationId: input.claim.correlationId,
		kind: input.kind,
		errorCode: input.errorCode ?? null,
	});
}
