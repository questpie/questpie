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
import {
	getCollections,
	getQueue,
	getWorkflowDefinitions,
} from "../routes/_helpers.js";

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
		const { instances, steps, events } = getCollections(ctx);
		const definitions = getWorkflowDefinitions(ctx);
		const executeQueue = getQueue(ctx, "questpie-wf-execute");

		return createWorkflowClient(definitions, {
			instances,
			steps,
			events,
			publishExecute: executeQueue,
		});
	});

export default workflowService;
