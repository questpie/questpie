/** Closed internal failure; no input, actor, SQL, or locator detail is exposed. */
export class DurableCheckpointError extends Error {
	constructor(
		readonly code:
			| "CHECKPOINT_INVALID"
			| "RESOURCE_LIMIT" = "CHECKPOINT_INVALID",
	) {
		super(code);
	}
}
