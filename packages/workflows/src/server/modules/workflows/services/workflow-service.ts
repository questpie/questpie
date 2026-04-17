/**
 * Workflow Service
 *
 * A singleton service that creates a WorkflowClient and places it at
 * `ctx.workflows` via namespace(null).
 *
 * This service bridges the WorkflowClient to the QUESTPIE collection CRUD
 * and queue APIs available in the ServiceCreateContext.
 */

import { service } from "questpie";

import { createWorkflowClient } from "../../../client.js";

/**
 * The workflow service definition.
 *
 * Uses `namespace(null)` to place the client at `ctx.workflows`
 * (top-level in AppContext) instead of `ctx.services.workflows`.
 */
export const workflowService = service()
	.namespace(null)
	.lifecycle("singleton")
	.create((ctx) => {
		const collections = (ctx as any).collections as
			| Record<string, any>
			| undefined;
		const queue = (ctx as any).queue as any;
		const app = (ctx as any).app as any;

		const instancesCrud = collections?.wf_instance;
		const stepsCrud = collections?.wf_step;
		const eventsCrud = collections?.wf_event;

		if (!instancesCrud || !stepsCrud || !eventsCrud) {
			throw new Error(
				"Workflow system collections not found. Is workflowsModule registered?",
			);
		}

		// Get workflow definitions from app state
		const definitions = (app?.state?.workflows ?? {}) as Record<string, any>;

		return createWorkflowClient(definitions, {
			instances: instancesCrud,
			steps: stepsCrud,
			events: eventsCrud,
			publishExecute: queue.wfExecute,
		});
	});

export default workflowService;
