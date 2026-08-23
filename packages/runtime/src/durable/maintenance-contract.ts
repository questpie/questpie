import type { Principal } from "questpie";

import type { DurableActor, DurableRunState } from "./rows";

export type DurableMaintenanceCommand =
	| "acknowledgeAmbiguity"
	| "cancelRun"
	| "retryRun";

export type DurableMaintenanceRejection =
	| "ALREADY_REQUESTED"
	| "ATTEMPTS_EXHAUSTED"
	| "AUTHORITY_DENIED"
	| "NOT_AMBIGUOUS"
	| "REASON_INVALID"
	| "RUN_IS_TERMINAL"
	| "RUN_NOT_FAILED"
	| "VERSION_MISMATCH";

type DurableMaintenanceSettledOutcome = Readonly<{
	commandId: string;
	command: DurableMaintenanceCommand;
	outcome: "applied" | "rejected";
	rejectionCode: Exclude<
		DurableMaintenanceRejection,
		"AUTHORITY_DENIED"
	> | null;
	stateBefore: DurableRunState;
	stateAfter: DurableRunState;
	version: number;
}>;

type DurableMaintenanceAuthorityDenial = Readonly<{
	commandId: string;
	command: DurableMaintenanceCommand;
	outcome: "rejected";
	rejectionCode: "AUTHORITY_DENIED";
	stateBefore: null;
	stateAfter: null;
	version: null;
}>;

export type DurableMaintenanceOutcome =
	| DurableMaintenanceAuthorityDenial
	| DurableMaintenanceSettledOutcome;

export type DurableMaintenanceAuditEntry = Readonly<{
	commandId: string;
	command: DurableMaintenanceCommand;
	outcome: "applied" | "rejected";
	rejectionCode: string | null;
	actor: DurableActor;
	stateBefore: string;
	stateAfter: string;
	reason: string | null;
}>;

export interface DurableMaintenance {
	cancelRun(
		input: Readonly<{
			runId: string;
			reason: string;
			actor: Principal;
			expectedVersion?: number;
		}>,
	): Promise<DurableMaintenanceOutcome>;
	retryRun(
		input: Readonly<{
			runId: string;
			reason: string;
			actor: Principal;
			expectedVersion?: number;
		}>,
	): Promise<DurableMaintenanceOutcome>;
	acknowledgeAmbiguity(
		input: Readonly<{
			runId: string;
			effectName: string;
			reason: string;
			actor: Principal;
			expectedVersion?: number;
		}>,
	): Promise<DurableMaintenanceOutcome>;
	audit(runId: string): Promise<readonly DurableMaintenanceAuditEntry[]>;
}

export type DurableMaintenanceAuthority = (
	request: Readonly<{
		actor: DurableActor;
		command: DurableMaintenanceCommand;
		runId: string;
	}>,
) => boolean | Promise<boolean>;
