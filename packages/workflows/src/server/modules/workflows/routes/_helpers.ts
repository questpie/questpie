/**
 * Shared helpers for workflow route handlers.
 * Prefixed with _ so codegen skips this file.
 */

import type { CollectionCrud } from "../../../client.js";

export function getCollections(ctx: any) {
	const collections = ctx.collections as
		| Record<string, CollectionCrud>
		| undefined;
	const instances = collections?.wf_instance;
	const steps = collections?.wf_step;
	const events = collections?.wf_event;
	const logs = collections?.wf_log;

	if (!instances || !steps || !events || !logs) {
		throw new Error(
			"Workflow system collections not found. Is workflowsModule registered?",
		);
	}

	return { instances, steps, events, logs };
}
