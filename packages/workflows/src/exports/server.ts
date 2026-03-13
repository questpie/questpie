// @questpie/workflows/server — server-only API
// Re-export everything from public API

// Client — workflow client factory + types
export type {
	CollectionCrud,
	QueuePublish,
	TriggerResult,
	WorkflowClient,
	WorkflowClientDeps,
} from "../server/client.js";
export { createWorkflowClient } from "../server/client.js";

// Engine — compensation
export type {
	CompensationEntry,
	CompensationResult,
} from "../server/engine/compensation.js";
export {
	createCompletedStepsMap,
	runCompensations,
} from "../server/engine/compensation.js";

// Engine — duration
export { parseDuration, resolveDate } from "../server/engine/duration.js";

// Engine — execution
export type {
	EngineContext,
	ExecutionResult,
	InstanceData,
} from "../server/engine/engine.js";
export { executeWorkflowHandler } from "../server/engine/engine.js";

// Engine — errors
export type { SuspendReason } from "../server/engine/errors.js";
export {
	NonDeterministicError,
	StepFailedError,
	StepRetryError,
	StepSuspendError,
	WorkflowError,
	WorkflowTimeoutError,
} from "../server/engine/errors.js";

// Engine — events
export type {
	EventPersistence,
	ResumeWaiterFn,
} from "../server/engine/events.js";
export {
	checkRetroactiveMatch,
	dispatchEvent,
	matchesCriteria,
} from "../server/engine/events.js";

// Engine — logger
export type {
	ExternalLogger,
	FlushCallback,
	LogEntry,
	LogLevel,
} from "../server/engine/logger.js";
export { WorkflowLoggerImpl } from "../server/engine/logger.js";

// Engine — step context
export type {
	CachedStep,
	StepPersistence,
	StepStatus,
	StepType,
	TriggerChildFn,
} from "../server/engine/step-context.js";
export { StepExecutionContext } from "../server/engine/step-context.js";

// Module (system collections + jobs + service)
export { workflowsModule } from "../server/modules/workflows/index.js";

// Codegen plugin
export { workflowsPlugin } from "../server/plugin.js";

export * from "./index.js";
