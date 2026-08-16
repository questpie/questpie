import type { Principal } from "questpie";

import type { PostgresRealtimeWatch } from "../../live-query";
import type {
	LiveQueryCoordinatorDelivery,
	LiveQueryCoordinatorEvaluation,
} from "./coordinator";

type MaybePromise<Value> = Value | Promise<Value>;

type DurableRealtimePreparedWatch = Readonly<{
	authorityPartitionDigest: string;
	evaluate(): Promise<LiveQueryCoordinatorEvaluation>;
}>;

export type DurableRealtimeAttachment = Readonly<{
	scopeId: string;
	principal: Principal;
	prepare(
		watch: PostgresRealtimeWatch,
		signal: AbortSignal,
	): MaybePromise<DurableRealtimePreparedWatch | null>;
	publish(
		watch: PostgresRealtimeWatch,
		delivery: LiveQueryCoordinatorDelivery,
	): MaybePromise<boolean>;
	publishFailure(
		watch: PostgresRealtimeWatch,
		code: "OUTPUT_INVALID" | "RESOURCE_LIMIT",
	): MaybePromise<boolean>;
	synchronize(bindingIds: ReadonlySet<string>): void;
}>;

export type DurableRealtimeOpen = Readonly<{
	scopeId: string;
	bindingId: string;
	principal: Principal;
	authorityPartitionDigest: string;
	queryIdentity: string;
	queryBytes: Uint8Array;
	inputBytes: Uint8Array;
	inputDigest: string;
	contextInputBytes: Uint8Array;
	resumeRequested: boolean;
	requestedResumeToken: string | null;
}>;

export interface DurableRealtimeCoordinator {
	attach(input: DurableRealtimeAttachment): Promise<boolean>;
	detach(input: DurableRealtimeAttachment): Promise<void>;
	open(input: DurableRealtimeOpen): Promise<"limit" | "opened" | "unavailable">;
	acknowledge(
		scopeId: string,
		bindingId: string,
		principal: Principal,
		resumeToken: string,
	): Promise<boolean>;
	close(
		scopeId: string,
		bindingId: string,
		principal: Principal,
	): Promise<boolean>;
	requestScan(): Promise<void>;
}
