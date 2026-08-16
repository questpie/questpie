import type { Principal } from "questpie";

import type { ObservedLiveQueryPlanV1 } from "../../live-query";
import type { DurableRealtimeCoordinator } from "./durable";

type MaybePromise<Value> = Value | Promise<Value>;

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

export type LiveQueryCoordinatorOpen<Context> = Readonly<{
	scopeId: string;
	bindingId: string;
	principal: Principal;
	context: Context;
	query: string;
	input: unknown;
	resumeToken: string | null;
	signal: AbortSignal;
	evaluate(): Promise<LiveQueryCoordinatorEvaluation>;
	publish(delivery: LiveQueryCoordinatorDelivery): MaybePromise<boolean>;
}>;

export interface LiveQueryCoordinator<Context> {
	readonly durable?: DurableRealtimeCoordinator;
	start(): Promise<void>;
	drain(): Promise<void>;
	open(
		input: LiveQueryCoordinatorOpen<Context>,
	): Promise<LiveQueryCoordinatorDelivery>;
	acknowledge(
		scopeId: string,
		bindingId: string,
		resumeToken: string,
	): Promise<boolean>;
	close(scopeId: string, bindingId: string): void;
	reconcile(): Promise<void>;
	currentPlan(
		scopeId: string,
		bindingId: string,
	): ObservedLiveQueryPlanV1 | undefined;
}
