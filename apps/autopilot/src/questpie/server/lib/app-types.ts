export type AppCollections = Questpie.AppContext["collections"];

export type WorkflowContextCollections = Pick<
	Questpie.WorkflowContext,
	"collections"
>;

export type WorkflowServiceContext = Pick<
	Questpie.WorkflowContext,
	"collections" | "workflows"
>;

/** Task field literals inferred from collection schema (workflow/MCP boundaries). */
export type TaskTypeValue =
	| "task"
	| "feature"
	| "bug"
	| "research"
	| "review"
	| "approval";
export type TaskStatusValue =
	| "pending"
	| "waiting"
	| "running"
	| "backlog"
	| "todo"
	| "in_progress"
	| "in_review"
	| "done"
	| "cancelled"
	| "duplicate"
	| "failed"
	| "review"
	| "approved";
export type TaskPriorityValue = "low" | "medium" | "high" | "urgent";
export type TaskScopeTypeValue = "project" | "company";
