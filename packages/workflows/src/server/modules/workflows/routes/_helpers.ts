/**
 * Shared helpers for workflow route handlers.
 * Prefixed with _ so codegen skips this file.
 */

import type {
	CollectionFindResult,
	QueuePublish,
	WorkflowSystemCollections,
} from "../../../client.js";
import type { WorkflowDefinition } from "../../../workflow/types.js";

type WorkflowQueueName = "questpie-wf-execute" | "questpie-wf-resume";

export type WorkflowRuntimeLogger = {
	debug(message: string, data?: Record<string, unknown>): void;
	info(message: string, data?: Record<string, unknown>): void;
	warn(message: string, data?: Record<string, unknown>): void;
	error(message: string, data?: Record<string, unknown>): void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRecordProperty<T>(
	record: Record<string, unknown>,
	key: string,
): T | undefined {
	const value = record[key];
	return isRecord(value) ? (value as T) : undefined;
}

export function getCollections(ctx: unknown) {
	const context = isRecord(ctx) ? ctx : {};
	const collections =
		getRecordProperty<Partial<WorkflowSystemCollections>>(
			context,
			"collections",
		) ?? undefined;
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

export function getQueue(
	ctx: unknown,
	jobName: WorkflowQueueName,
): QueuePublish {
	const context = isRecord(ctx) ? ctx : {};
	const queue =
		getRecordProperty<Partial<Record<WorkflowQueueName, QueuePublish>>>(
			context,
			"queue",
		) ?? undefined;
	const publisher = queue?.[jobName];
	if (!publisher) {
		throw new Error(`Workflow queue publisher not found: ${jobName}`);
	}
	return publisher;
}

export function getWorkflowDefinitions(
	ctx: unknown,
): Record<string, WorkflowDefinition> {
	const context = isRecord(ctx) ? ctx : {};
	const app = getRecordProperty<{
		state?: {
			workflows?: Record<string, WorkflowDefinition>;
		};
	}>(context, "app");

	return app?.state?.workflows ?? {};
}

export function getTotalDocs<TDocument>(
	result: CollectionFindResult<TDocument>,
): number {
	return result.totalDocs ?? result.docs.length;
}

export function getCountValue(result: number | { totalDocs: number }): number {
	return typeof result === "number" ? result : result.totalDocs;
}

export function getLogger(ctx: unknown): WorkflowRuntimeLogger | undefined {
	const context = isRecord(ctx) ? ctx : {};
	const logger = context.logger;
	return isRecord(logger) ? (logger as WorkflowRuntimeLogger) : undefined;
}

export function asMatchCriteria(
	value: unknown,
): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}
