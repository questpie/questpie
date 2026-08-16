import { isOperationCallId, isPostgresTransactionId } from "./call-identity";

export type CommittedResultUnavailablePayload = Readonly<{
	callId: string;
	transactionId: string;
}>;

export class CommittedResultUnavailable extends Error {
	readonly name = "CommittedResultUnavailable" as const;
	readonly code = "COMMITTED_RESULT_UNAVAILABLE" as const;
	readonly retryable = true as const;
	readonly payload: CommittedResultUnavailablePayload;

	constructor(callId: string, transactionId: string, cause?: unknown) {
		if (!isOperationCallId(callId))
			throw new TypeError("Committed result call identity is invalid");
		if (!isPostgresTransactionId(transactionId))
			throw new TypeError("Committed result transaction identity is invalid");
		super("COMMITTED_RESULT_UNAVAILABLE", { cause });
		this.payload = Object.freeze({ callId, transactionId });
		Object.freeze(this);
	}
}
