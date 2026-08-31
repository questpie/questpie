import type { QuestpieObservability } from "questpie";

import {
	createObservationKernel,
	type ExecutionEventV2,
	resolveObservationHandle,
} from "../observation";
import { DeclaredOperationError, OperationFailure } from "../operation";

export function createApplicationObservation(
	input: Readonly<{
		applicationIdentity: string;
		runtimeBuildDigest: string;
		observability?: QuestpieObservability;
		events?: (event: ExecutionEventV2) => void;
		wallClock?: () => Date;
	}>,
) {
	if (input.observability === undefined && input.events === undefined)
		return null;
	return createObservationKernel({
		applicationIdentity: input.applicationIdentity,
		runtimeBuildDigest: input.runtimeBuildDigest,
		...(input.observability === undefined
			? {}
			: { adapter: resolveObservationHandle(input.observability) }),
		events: input.events,
		wallClock: input.wallClock,
	});
}

export function applicationObservationFailure(
	error: unknown,
	input: Readonly<{
		committedMutation: boolean;
		deadlineExpired: boolean;
		aborted: boolean;
	}>,
) {
	const errorCode =
		error instanceof DeclaredOperationError || error instanceof OperationFailure
			? error.code
			: undefined;
	const code = errorCode === undefined ? {} : { errorCode };
	if (input.deadlineExpired && !input.committedMutation)
		return { outcome: "deadline" as const, ...code };
	if (input.aborted && !input.committedMutation)
		return { outcome: "cancelled" as const, ...code };
	if (error instanceof DeclaredOperationError)
		return { outcome: "declared_error" as const, ...code };
	return { outcome: "framework_error" as const, ...code };
}
