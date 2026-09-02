import type {
	ObservationEventKind,
	ObservationOutcome,
	ScopeKind,
} from "./contract";

/** Exact closed event-to-scope grammar shared by Runtime and its generated signal artifact. */
export const EVENT_SCOPES: Readonly<
	Record<ObservationEventKind, readonly ScopeKind[]>
> = Object.freeze({
	"context.completed": ["execution"],
	"receipt.replayed": ["mutation"],
	"transaction.committed": ["transaction"],
	"operation.post_commit_ambiguous": ["mutation"],
	"durable.accepted": ["job.accept", "reaction.accept"],
	"execution.cancelled": ["execution"],
	"execution.deadline_exceeded": ["execution"],
	"durable.fenced": ["job.attempt", "reaction.attempt"],
	"durable.retry_scheduled": ["job.attempt", "reaction.attempt"],
	"durable.terminal": ["job.attempt", "reaction.attempt"],
	"action.ambiguous": ["action.effect"],
});

/** Event-specific closed outcomes. Events absent here carry no outcome. */
export const EVENT_OUTCOMES = Object.freeze({
	"durable.terminal": Object.freeze([
		"ok",
		"framework_error",
		"cancelled",
	] as const),
});

/** Exact closed scope-end outcome grammar. */
export const END_OUTCOMES: Readonly<
	Record<ScopeKind, readonly ObservationOutcome[]>
> = Object.freeze({
	runtime: ["ok", "framework_error", "cancelled", "deadline"],
	fetch: ["ok", "framework_error", "cancelled", "deadline"],
	route: ["ok", "framework_error", "cancelled", "deadline"],
	execution: [
		"ok",
		"declared_error",
		"framework_error",
		"cancelled",
		"deadline",
	],
	query: ["ok", "declared_error", "framework_error", "cancelled", "deadline"],
	mutation: [
		"ok",
		"declared_error",
		"framework_error",
		"cancelled",
		"deadline",
		"ambiguous",
	],
	action: [
		"ok",
		"declared_error",
		"framework_error",
		"cancelled",
		"deadline",
		"ambiguous",
	],
	transaction: ["ok", "framework_error", "cancelled", "deadline"],
	postgresql: ["ok", "framework_error", "cancelled", "deadline"],
	"job.accept": [
		"ok",
		"declared_error",
		"framework_error",
		"cancelled",
		"deadline",
	],
	"reaction.accept": [
		"ok",
		"declared_error",
		"framework_error",
		"cancelled",
		"deadline",
	],
	"job.attempt": [
		"ok",
		"declared_error",
		"framework_error",
		"cancelled",
		"deadline",
		"fenced",
		"retry",
	],
	"reaction.attempt": [
		"ok",
		"declared_error",
		"framework_error",
		"cancelled",
		"deadline",
		"fenced",
		"retry",
	],
	"action.effect": [
		"ok",
		"declared_error",
		"framework_error",
		"cancelled",
		"deadline",
		"ambiguous",
	],
});
