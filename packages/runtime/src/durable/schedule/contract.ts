import type { PostgresTransaction } from "../../postgres/contract";
import type { JobAcceptanceReceipt } from "../acceptance";
import type { UtcCronCalendar } from "./calendar";

export { parseUtcCron, evaluateLatestCronMatch } from "./calendar";
export type { UtcCronCalendar } from "./calendar";

export type StaticJobSchedule = Readonly<{
	jobIdentity: string;
	programDigest: string;
	cron: UtcCronCalendar;
	principal: Readonly<{ kind: "service"; id: string }>;
	contextJson: string;
	inputJson: string;
}>;

export type StaticJobScheduleArtifact = Readonly<{
	format: "questpie.job-schedules";
	version: 1;
	application: string;
	compilerRuntimeBuildDigest: string;
	jobProjectionDigest: string;
	digest: string;
	schedules: readonly StaticJobSchedule[];
}>;

export type StaticScheduleAcceptance = (
	request: Readonly<{
		transaction: PostgresTransaction;
		schedule: StaticJobSchedule;
		tickId: string;
		scheduledMinute: Date;
		observedAt: Date;
		signal: AbortSignal;
	}>,
) => Promise<JobAcceptanceReceipt>;

export type StaticScheduleHead = Readonly<{
	revision: string;
	targetDigest: string;
	activatedAt: string;
}>;

export type StaticScheduleActivationReceipt = Readonly<{
	requestIdentity: string;
	acceptedRevision: string;
	targetDigest: string;
	activatedAt: string;
	currentHead: StaticScheduleHead;
	replayed: boolean;
}>;

export class StaticScheduleFailure extends Error {
	constructor(
		readonly code:
			| "SCHEDULE_ARTIFACT_INVALID"
			| "SCHEDULE_ACTIVATION_STALE"
			| "SCHEDULE_REVISION_OVERFLOW"
			| "SCHEDULE_STATE_INVALID",
		readonly currentHead?: Pick<
			StaticScheduleHead,
			"revision" | "targetDigest"
		>,
	) {
		super(code);
		this.name = "StaticScheduleFailure";
	}
}
