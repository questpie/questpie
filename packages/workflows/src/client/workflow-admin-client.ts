import type {
	WorkflowInstance,
	WorkflowLogRecord,
	WorkflowStepRecord,
} from "../server/workflow/types.js";

export type WorkflowInstanceListResponse = {
	docs: WorkflowInstance[];
	totalDocs: number;
	page: number;
	limit: number;
};

export type WorkflowInstanceDetailResponse = {
	instance: WorkflowInstance;
	steps: WorkflowStepRecord[];
	logs: WorkflowLogRecord[];
};

export type WorkflowAdminRoutes = {
	listWorkflowInstances(input: {
		status?: string;
		limit: number;
		page: number;
	}): Promise<WorkflowInstanceListResponse>;
	getWorkflowInstance(input: {
		id: string;
		includeSteps: boolean;
		includeLogs: boolean;
	}): Promise<WorkflowInstanceDetailResponse>;
	cancelWorkflowInstance(input: { id: string }): Promise<{ success: boolean }>;
	retryWorkflowInstance(input: { id: string }): Promise<{ success: boolean }>;
};

type WorkflowAdminClient = {
	routes: WorkflowAdminRoutes;
};

export function getWorkflowRoutes(client: unknown): WorkflowAdminRoutes {
	if (!client || typeof client !== "object" || !("routes" in client)) {
		throw new Error("Workflow admin routes are not available");
	}

	return (client as WorkflowAdminClient).routes;
}
