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

interface LiveQueryCoordinatorLifecycle {
	start(): Promise<void>;
	drain(): Promise<void>;
	reconcile(): Promise<void>;
}

export type LiveQueryCoordinator = LiveQueryCoordinatorLifecycle &
	Readonly<{ durable?: DurableRealtimeCoordinator }>;
