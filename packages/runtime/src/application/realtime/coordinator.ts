import type { ObservedLiveQueryPlanV1 } from "../../live-query";
import type { DurableRealtimeCoordinator } from "./durable";

export type LiveQueryCoordinatorEvaluation = Readonly<{
	payload: unknown;
	observedPlan: ObservedLiveQueryPlanV1;
}>;

export type LiveQueryCoordinatorDelivery = Readonly<{
	payload: unknown;
	observedPlan: ObservedLiveQueryPlanV1;
	delivery: "initial" | "reset" | "update";
	resetReason:
		| "authority-changed"
		| "deployment-changed"
		| "resume-unavailable"
		| null;
	resumeToken: string;
}>;

export class LiveQueryEvaluationFailure extends Error {
	readonly code: "AUTHORIZATION_FAILED" | "OUTPUT_INVALID" | "RESOURCE_LIMIT";

	constructor(code: LiveQueryEvaluationFailure["code"]) {
		super(code);
		this.code = code;
	}
}

interface LiveQueryCoordinatorLifecycle {
	start(): Promise<void>;
	drain(input: Readonly<{ deadlineAt: number }>): Promise<void>;
}

export type LiveQueryCoordinator = LiveQueryCoordinatorLifecycle &
	Readonly<{ durable?: DurableRealtimeCoordinator }>;
