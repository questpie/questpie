import { QuestpiePostgresError } from "./contract";

function sqlState(error: unknown): string | undefined {
	if (!error || typeof error !== "object" || !("code" in error))
		return undefined;
	return typeof error.code === "string" && /^[0-9A-Z]{5}$/u.test(error.code)
		? error.code
		: undefined;
}

export function postgresFailure(
	input: Readonly<{
		error: unknown;
		phase: QuestpiePostgresError["phase"];
		statementName?: string;
		commitSent?: boolean;
		signal?: AbortSignal;
		overridePhase?: boolean;
	}>,
): QuestpiePostgresError {
	if (input.error instanceof QuestpiePostgresError) {
		if (!input.overridePhase) return input.error;
		return new QuestpiePostgresError({
			code: input.error.code,
			phase: input.phase,
			statementName: input.error.statementName,
			sqlState: input.error.sqlState,
			retry: input.error.retry,
			cause: input.error,
		});
	}
	const state = sqlState(input.error);
	if (input.commitSent)
		return new QuestpiePostgresError({
			code: "commitOutcomeUnknown",
			phase: "commit",
			retry: "callerMustResolveCommit",
			cause: input.error,
		});
	if (input.signal?.aborted)
		return new QuestpiePostgresError({
			code: "cancelled",
			phase: input.phase,
			statementName: input.statementName,
			cause: input.signal.reason,
		});
	const classification =
		(input.phase === "connect" || input.phase === "listen") && !state
			? "connectionLost"
			: state === "57014"
				? "statementTimeout"
				: state === "55P03"
					? "lockTimeout"
					: state === "40001"
						? "serializationFailure"
						: state === "40P01"
							? "deadlock"
							: state?.startsWith("23")
								? "constraint"
								: state?.startsWith("08")
									? "connectionLost"
									: "queryFailed";
	return new QuestpiePostgresError({
		code: classification,
		phase: input.phase,
		statementName: input.statementName,
		sqlState: state,
		retry:
			classification === "serializationFailure" ||
			classification === "deadlock" ||
			((input.phase === "connect" || input.phase === "listen") &&
				classification === "connectionLost")
				? "safeBeforeCommit"
				: "never",
		cause: input.error,
	});
}
