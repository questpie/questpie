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
							: // ADR-0048 database immutability guards: QP001 (append-only
								// Collection) and QP002 (write-once Field) are compiler-owned,
								// reserved SQLSTATE codes raised only by the guard trigger
								// itself, never by application logic. A generated kernel
								// should never reach a guard (compile-time capability
								// suppression refuses the write before any SQL is emitted),
								// so this classification only fires on a compiler capability
								// bug, a raw bypass writer, or a Seed conflict path this
								// runtime layer does not own. Never safe to retry: retrying
								// the same write hits the same guard again. Deliberately
								// does not carry the Collection/Field identity from the raw
								// PostgreSQL error message into anything a network caller
								// can read -- callers get the classification only.
								state === "QP001" || state === "QP002"
								? "immutabilityGuardViolation"
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
