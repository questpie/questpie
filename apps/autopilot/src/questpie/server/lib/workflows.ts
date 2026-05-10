export type WorkflowsApi = {
	trigger(
		name: string,
		input: unknown,
		options?: { idempotencyKey?: string },
	): Promise<{ instanceId: string; existing: boolean }>;
	sendEvent(
		event: string,
		data?: unknown,
		match?: Record<string, unknown>,
	): Promise<void>;
};

export function workflowsFromContext(ctx: unknown): WorkflowsApi {
	const workflows = (ctx as { workflows?: WorkflowsApi }).workflows;
	if (!workflows) {
		throw new Error("Workflow service is not available");
	}
	return workflows;
}
