/**
 * @questpie/workflows — Durable Workflow Engine
 *
 * Provides replay-based, crash-resilient workflow orchestration
 * for long-running business processes.
 *
 * @example
 * ```ts
 * // questpie.config.ts
 * import { workflowsPlugin } from "@questpie/workflows";
 * export default runtimeConfig({
 *   plugins: [workflowsPlugin()],
 * });
 *
 * // modules.ts
 * import { workflowsModule } from "@questpie/workflows";
 * export default [workflowsModule];
 * ```
 */

// Plugin & module
export { workflowsPlugin } from "#workflows/server/plugin.js";
export { default as workflowsModule } from "#workflows/server/module/index.js";

// Init function
export { initWorkflows } from "#workflows/server/init.js";

// Client
export {
	createWorkflowClient,
	type WorkflowHandle,
	type WorkflowClient,
} from "#workflows/server/client.js";

// Re-export core types for convenience
export type {
	WorkflowDefinition,
	WorkflowHandlerContext,
	WorkflowHandlerOptions,
	WorkflowTriggerOptions,
	StepToolbox,
	WorkflowLogger,
	WorkflowInstanceStatus,
	WorkflowStepStatus,
	WorkflowEventType,
	WorkflowLogLevel,
	InferWorkflowInput,
	InferWorkflowOutput,
	InferWorkflowName,
} from "questpie";
