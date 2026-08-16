export type CommittedResultUnavailablePayload = Readonly<{
	callId: string;
	transactionId: string;
}>;

export class CommittedResultUnavailable extends Error {
	readonly code = "COMMITTED_RESULT_UNAVAILABLE" as const;
	readonly payload: CommittedResultUnavailablePayload;

	constructor(callId: string, transactionId: string, cause: unknown) {
		super("COMMITTED_RESULT_UNAVAILABLE", { cause });
		this.name = "CommittedResultUnavailable";
		this.payload = Object.freeze({ callId, transactionId });
		Object.freeze(this);
	}
}
