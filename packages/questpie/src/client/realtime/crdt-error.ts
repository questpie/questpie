export class RealtimeCrdtBindingRejectedError extends Error {
	readonly code = "REALTIME_CRDT_BINDING_REJECTED";

	constructor(
		readonly topologyEntryId: string,
		message = "CRDT realtime binding unavailable",
	) {
		super(message);
		this.name = "RealtimeCrdtBindingRejectedError";
	}
}
