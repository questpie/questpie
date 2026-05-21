export type WorkflowsApi = NonNullable<Questpie.AppContext["workflows"]>;

export function workflowsFromContext(ctx: {
	workflows?: Questpie.AppContext["workflows"];
}): WorkflowsApi {
	const workflows = ctx.workflows;
	if (!workflows) {
		throw new Error("Workflow service is not available");
	}
	return workflows;
}
