import type { WorkflowDefinition } from "questpie";
import { setAppRef } from "./app-ref.js";
import { createWorkflowClient } from "./client.js";

/**
 * Initialize the workflows extension.
 *
 * Reads workflow definitions from `app.state.workflows`,
 * creates a WorkflowClient, and stores it on `app.extensions.workflows`.
 *
 * Must be called AFTER `createApp()` but BEFORE handling requests.
 *
 * @example
 * ```ts
 * import { createApp } from "questpie";
 * import { initWorkflows, workflowsModule } from "@questpie/workflows";
 *
 * const app = createApp({
 *   modules: [workflowsModule],
 *   // ...
 * });
 *
 * initWorkflows(app);
 *
 * // Now ctx.workflows is available in hooks, routes, functions:
 * // await ctx.workflows.myWorkflow.trigger({ ... });
 * ```
 */
export function initWorkflows(app: any): void {
	// Store the app reference for job handlers
	setAppRef(app);

	// Read workflow definitions from state (populated by codegen/module merging)
	const workflowDefs =
		(app.state?.workflows as Record<string, WorkflowDefinition>) ?? {};

	// Create the typed client
	const client = createWorkflowClient(workflowDefs, app);

	// Register on extensions map — spread into AppContext by extractAppServices()
	app.extensions.workflows = client;
}
