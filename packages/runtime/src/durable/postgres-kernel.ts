import type { SQL } from "bun";

import type {
	LinkedReactionProjection,
	LinkedReactionRetry,
} from "./projection";
import {
	decodeRetryBytes,
	durableBytes,
	durableDate,
	durableInteger,
	durablePrincipalKind,
	durableText,
	leaseTokenDigest,
	markDurableKernelTransaction,
	retryDelayMilliseconds,
	type DurablePrincipalKind,
	type DurableQuery,
	type DurableRow,
} from "./rows";

export type DurableRunState =
	| "cancelled"
	| "delayed"
	| "failed"
	| "ready"
	| "running"
	| "succeeded";

export type DurableFailureCode =
	| "EFFECT_AMBIGUOUS"
	| "EFFECT_CONFLICT"
	| "HANDLER_FAILED"
	| "REACTION_ERROR"
	| "RESOURCE_LIMIT"
	| "RETRY_EXHAUSTED"
	| "RUN_AS_DENIED"
	| "VALIDATION_FAILED";

const permanentFailureCodes: ReadonlySet<DurableFailureCode> = new Set([
	"EFFECT_AMBIGUOUS",
	"EFFECT_CONFLICT",
	"REACTION_ERROR",
	"RESOURCE_LIMIT",
	"RUN_AS_DENIED",
	"VALIDATION_FAILED",
]);

function postgresErrorNumber(error: unknown): string | null {
	if (!error || typeof error !== "object") return null;
	const errno = (error as Readonly<{ errno?: unknown }>).errno;
	return typeof errno === "string" ? errno : null;
}

export type DurableClaim = Readonly<{
	runId: string;
	dispatchId: string;
	resource: string;
	attemptId: string;
	attemptNumber: number;
	leaseToken: string;
	leaseMilliseconds: number;
	leaseExpiresAt: Date;
	deadlineAt: Date;
	workerId: string;
	tenantId: string;
	principal: Readonly<{ kind: DurablePrincipalKind; id: string }>;
	contextInputBytes: Uint8Array;
	payloadBytes: Uint8Array;
	retry: LinkedReactionRetry;
	runtimeBuildDigest: string;
	executableDigest: string;
	causationId: string;
	correlationId: string;
	cancellationRequested: boolean;
}>;

export type DurableAdmission = Readonly<{
	runId: string;
	resource: string;
	executableDigest: string;
}>;

export type DurableClaimOutcome =
	| Readonly<{ status: "claimed"; claim: DurableClaim }>
	| Readonly<{ status: "skipped" }>
	| Readonly<{ status: "refused"; code: "EXECUTABLE_RETIRED" }>;

export type DurableHeartbeat = Readonly<{
	status: "fenced" | "held";
	cancellationRequested: boolean;
	deadlineExpired: boolean;
}>;

export type DurableTransition = Readonly<{
	status: "applied" | "fenced";
	state: DurableRunState | null;
	deadLetter: boolean;
}>;

export type DurableRunView = Readonly<{
	runId: string;
	/** The append-only history length: the run version a command may fence on. */
	version: number;
	dispatchId: string;
	resource: string;
	state: DurableRunState;
	attemptCount: number;
	currentAttemptId: string | null;
	cancellationRequested: boolean;
	deadLetter: boolean;
	failureCode: string | null;
	resultBytes: Uint8Array | null;
	availableAt: Date;
	terminalAt: Date | null;
}>;

export type DurableRunEventView = Readonly<{
	sequence: number;
	kind: string;
	attemptId: string | null;
	leaseTokenDigest: string | null;
	errorCode: string | null;
}>;

const runSelection = `run_id::text AS "runId",
       dispatch_id::text AS "dispatchId",
       resource_identity AS "resource",
       tenant_id AS "tenantId",
       principal_kind AS "principalKind",
       principal_id AS "principalId",
       context_input_bytes AS "contextInputBytes",
       payload_bytes AS "payloadBytes",
       retry_bytes AS "retryBytes",
       runtime_build_digest AS "runtimeBuildDigest",
       executable_digest AS "executableDigest",
       causation_id AS "causationId",
       correlation_id AS "correlationId",
       cancellation_requested AS "cancellationRequested",
       attempt_count AS "attemptCount"`;

function claimRow(
	row: DurableRow,
	input: Readonly<{
		workerId: string;
		attemptId: string;
		attemptNumber: number;
		leaseToken: string;
		leaseMilliseconds: number;
		leaseExpiresAt: Date;
		deadlineAt: Date;
	}>,
): DurableClaim {
	return Object.freeze({
		runId: durableText(row.runId, "run identity"),
		dispatchId: durableText(row.dispatchId, "dispatch identity"),
		resource: durableText(row.resource, "Resource Identity"),
		attemptId: input.attemptId,
		attemptNumber: input.attemptNumber,
		leaseToken: input.leaseToken,
		leaseMilliseconds: input.leaseMilliseconds,
		leaseExpiresAt: input.leaseExpiresAt,
		deadlineAt: input.deadlineAt,
		workerId: input.workerId,
		tenantId: durableText(row.tenantId, "Tenant"),
		principal: Object.freeze({
			kind: durablePrincipalKind(row.principalKind, "Principal kind"),
			id: durableText(row.principalId, "Principal identity"),
		}),
		contextInputBytes: durableBytes(row.contextInputBytes, "Context input"),
		payloadBytes: durableBytes(row.payloadBytes, "payload"),
		retry: decodeRetryBytes(row.retryBytes),
		runtimeBuildDigest: durableText(
			row.runtimeBuildDigest,
			"Runtime Build digest",
		),
		executableDigest: durableText(row.executableDigest, "executable digest"),
		causationId: durableText(row.causationId, "causation identity"),
		correlationId: durableText(row.correlationId, "correlation identity"),
		cancellationRequested: row.cancellationRequested === true,
	});
}

async function appendEvent(
	query: DurableQuery,
	input: Readonly<{
		application: string;
		runId: string;
		resource: string;
		dispatchId: string;
		causationId: string;
		correlationId: string;
		kind: string;
		attemptId?: string | null;
		leaseTokenDigest?: string | null;
		errorCode?: string | null;
	}>,
): Promise<void> {
	const [bumped] = await query(
		`UPDATE questpie_internal.durable_runs
SET event_sequence = event_sequence + 1
WHERE application_name = $1 AND run_id = $2
RETURNING event_sequence AS "sequence"`,
		[input.application, input.runId],
	);
	if (!bumped) throw new TypeError("durable run history has no run");
	await query(
		`INSERT INTO questpie_internal.durable_run_events
  (application_name, run_id, sequence, occurred_at, resource_identity, dispatch_id,
   attempt_id, lease_token_digest, causation_id, correlation_id, kind, error_code)
VALUES ($1, $2, $3, pg_catalog.transaction_timestamp(), $4, $5, $6, $7, $8, $9, $10, $11)`,
		[
			input.application,
			input.runId,
			durableInteger(bumped.sequence, "run event sequence"),
			input.resource,
			input.dispatchId,
			input.attemptId ?? null,
			input.leaseTokenDigest ?? null,
			input.causationId,
			input.correlationId,
			input.kind,
			input.errorCode ?? null,
		],
	);
}

export interface DurableKernel {
	readonly application: string;
	admit(batch?: number): Promise<readonly DurableAdmission[]>;
	reapCancelled(limit?: number): Promise<number>;
	claim(
		input: Readonly<{
			runId: string;
			workerId: string;
			leaseMilliseconds?: number;
			attemptDeadlineMilliseconds?: number;
		}>,
	): Promise<DurableClaimOutcome>;
	heartbeat(claim: DurableClaim): Promise<DurableHeartbeat>;
	succeed(
		claim: DurableClaim,
		resultBytes: Uint8Array,
	): Promise<DurableTransition>;
	fail(
		claim: DurableClaim,
		failure: Readonly<{ code: DurableFailureCode }>,
	): Promise<DurableTransition>;
	cancel(claim: DurableClaim): Promise<DurableTransition>;
	inspect(runId: string): Promise<DurableRunView | null>;
	events(runId: string): Promise<readonly DurableRunEventView[]>;
}

export function createPostgresDurableKernel(
	input: Readonly<{
		sql: SQL;
		application: string;
		reactions: LinkedReactionProjection;
		claimBatch?: number;
		random?: () => number;
	}>,
): DurableKernel {
	const maximumBatch = input.claimBatch ?? 64;
	if (
		!Number.isSafeInteger(maximumBatch) ||
		maximumBatch < 1 ||
		maximumBatch > 64
	)
		throw new TypeError("durable claim batch must be between 1 and 64");
	const executableDigests = [
		...new Set(
			[...input.reactions.byIdentity.values()].map(
				(reaction) => reaction.contractDigest,
			),
		),
	].sort();
	const random = input.random ?? Math.random;
	const transaction = <Result>(
		use: (query: DurableQuery) => Promise<Result>,
	): Promise<Result> =>
		input.sql.begin(async (session) => {
			const query: DurableQuery = (statement, parameters = []) =>
				session.unsafe(statement, [...parameters]) as unknown as Promise<
					readonly DurableRow[]
				>;
			await markDurableKernelTransaction(query);
			return use(query);
		}) as Promise<Result>;

	const terminal = async (
		claim: DurableClaim,
		outcome: "cancelled" | "failed" | "succeeded",
		detail: Readonly<{
			state: DurableRunState;
			failureCode: DurableFailureCode | null;
			resultBytes: Uint8Array | null;
			deadLetter: boolean;
			eventKind: string;
		}>,
	): Promise<DurableTransition> =>
		transaction(async (query) => {
			const applied = await query(
				`UPDATE questpie_internal.durable_runs
SET state = $5, current_attempt_id = NULL, lease_token_digest = NULL, lease_expires_at = NULL,
    result_bytes = $6, failure_code = $7, dead_letter = $8,
    terminal_at = pg_catalog.transaction_timestamp()
WHERE application_name = $1 AND run_id = $2
  AND current_attempt_id = $3 AND lease_token_digest = $4
RETURNING state`,
				[
					input.application,
					claim.runId,
					claim.attemptId,
					leaseTokenDigest(claim.leaseToken),
					detail.state,
					detail.resultBytes,
					detail.failureCode,
					detail.deadLetter,
				],
			);
			if (applied.length === 0)
				return Object.freeze({
					status: "fenced" as const,
					state: null,
					deadLetter: false,
				});
			await query(
				`UPDATE questpie_internal.durable_attempts
SET outcome = $3, failure_code = $4
WHERE application_name = $1 AND attempt_id = $2`,
				[
					input.application,
					claim.attemptId,
					outcome,
					outcome === "failed" ? detail.failureCode : null,
				],
			);
			await appendEvent(query, {
				application: input.application,
				runId: claim.runId,
				resource: claim.resource,
				dispatchId: claim.dispatchId,
				causationId: claim.causationId,
				correlationId: claim.correlationId,
				kind: detail.eventKind,
				attemptId: claim.attemptId,
				leaseTokenDigest: leaseTokenDigest(claim.leaseToken),
				errorCode: detail.failureCode,
			});
			return Object.freeze({
				status: "applied" as const,
				state: detail.state,
				deadLetter: detail.deadLetter,
			});
		});

	const scheduleRetry = async (
		claim: DurableClaim,
		code: DurableFailureCode,
	): Promise<DurableTransition> =>
		transaction(async (query) => {
			const delay = retryDelayMilliseconds(
				claim.retry,
				claim.attemptNumber,
				random,
			);
			const applied = await query(
				`UPDATE questpie_internal.durable_runs
SET state = 'delayed', current_attempt_id = NULL, lease_token_digest = NULL,
    lease_expires_at = NULL, failure_code = $5,
    available_at = LEAST(
      pg_catalog.transaction_timestamp() + make_interval(secs => $6::double precision),
      horizon_at
    )
WHERE application_name = $1 AND run_id = $2
  AND current_attempt_id = $3 AND lease_token_digest = $4
RETURNING state`,
				[
					input.application,
					claim.runId,
					claim.attemptId,
					leaseTokenDigest(claim.leaseToken),
					code,
					delay / 1_000,
				],
			);
			if (applied.length === 0)
				return Object.freeze({
					status: "fenced" as const,
					state: null,
					deadLetter: false,
				});
			await query(
				`UPDATE questpie_internal.durable_attempts
SET outcome = 'failed', failure_code = $3
WHERE application_name = $1 AND attempt_id = $2`,
				[input.application, claim.attemptId, code],
			);
			await appendEvent(query, {
				application: input.application,
				runId: claim.runId,
				resource: claim.resource,
				dispatchId: claim.dispatchId,
				causationId: claim.causationId,
				correlationId: claim.correlationId,
				kind: "retryScheduled",
				attemptId: claim.attemptId,
				leaseTokenDigest: leaseTokenDigest(claim.leaseToken),
				errorCode: code,
			});
			return Object.freeze({
				status: "applied" as const,
				state: "delayed" as const,
				deadLetter: false,
			});
		});

	return Object.freeze<DurableKernel>({
		application: input.application,
		async reapCancelled(limit = maximumBatch) {
			try {
				return await transaction(async (query) => {
					const cancelled = await query(
						`UPDATE questpie_internal.durable_runs
SET state = 'cancelled', current_attempt_id = NULL, lease_token_digest = NULL,
    lease_expires_at = NULL, failure_code = NULL,
    terminal_at = pg_catalog.transaction_timestamp()
WHERE (application_name, run_id) IN (
  SELECT application_name, run_id FROM questpie_internal.durable_runs
  WHERE application_name = $1 AND cancellation_requested
    AND (state IN ('delayed', 'ready')
      OR (state = 'running' AND lease_expires_at <= pg_catalog.transaction_timestamp()))
  ORDER BY run_id
  LIMIT $2
)
RETURNING run_id::text AS "runId", resource_identity AS "resource",
          dispatch_id::text AS "dispatchId", causation_id AS "causationId",
          correlation_id AS "correlationId"`,
						[input.application, limit],
					);
					for (const row of cancelled) {
						await query(
							`UPDATE questpie_internal.durable_attempts
SET outcome = 'cancelled'
WHERE application_name = $1 AND run_id = $2 AND outcome IS NULL`,
							[input.application, durableText(row.runId, "run identity")],
						);
						await appendEvent(query, {
							application: input.application,
							runId: durableText(row.runId, "run identity"),
							resource: durableText(row.resource, "Resource Identity"),
							dispatchId: durableText(row.dispatchId, "dispatch identity"),
							causationId: durableText(row.causationId, "causation identity"),
							correlationId: durableText(
								row.correlationId,
								"correlation identity",
							),
							kind: "cancelled",
						});
					}
					return cancelled.length;
				});
			} catch (error) {
				if (postgresErrorNumber(error) === "40001") return 0;
				throw error;
			}
		},
		async admit(batch = maximumBatch) {
			if (!Number.isSafeInteger(batch) || batch < 1 || batch > maximumBatch)
				throw new TypeError(
					`durable admission batch must be between 1 and ${maximumBatch}`,
				);
			const rows = (await input.sql.unsafe(
				`WITH eligible AS (
  SELECT run_id, resource_identity, executable_digest, available_at,
         row_number() OVER (PARTITION BY tenant_id ORDER BY available_at, run_id) AS tenant_turn
  FROM questpie_internal.durable_runs
  WHERE application_name = $1
    AND executable_digest IN (
      SELECT pg_catalog.jsonb_array_elements_text(($2::text)::jsonb)
    )
    AND NOT cancellation_requested
    AND ((state IN ('delayed', 'ready') AND available_at <= pg_catalog.transaction_timestamp())
      OR (state = 'running' AND lease_expires_at <= pg_catalog.transaction_timestamp()))
)
SELECT run_id::text AS "runId", resource_identity AS "resource",
       executable_digest AS "executableDigest"
FROM eligible
ORDER BY tenant_turn, available_at, run_id
LIMIT $3`,
				[input.application, JSON.stringify(executableDigests), batch],
			)) as unknown as readonly DurableRow[];
			return Object.freeze(
				rows.map((row) =>
					Object.freeze({
						runId: durableText(row.runId, "run identity"),
						resource: durableText(row.resource, "Resource Identity"),
						executableDigest: durableText(
							row.executableDigest,
							"executable digest",
						),
					}),
				),
			);
		},
		async claim(request) {
			const leaseMilliseconds = request.leaseMilliseconds ?? 30_000;
			const deadlineMilliseconds =
				request.attemptDeadlineMilliseconds ?? 300_000;
			if (
				!Number.isSafeInteger(leaseMilliseconds) ||
				leaseMilliseconds < 1_000 ||
				leaseMilliseconds > 30_000
			)
				throw new TypeError("durable lease must be between 1000 and 30000 ms");
			if (
				!Number.isSafeInteger(deadlineMilliseconds) ||
				deadlineMilliseconds < leaseMilliseconds ||
				deadlineMilliseconds > 300_000
			)
				throw new TypeError("durable attempt deadline is outside its bound");
			try {
				return await transaction(
					async (query): Promise<DurableClaimOutcome> => {
						const [row] = await query(
							`SELECT ${runSelection}
FROM questpie_internal.durable_runs
WHERE application_name = $1 AND run_id = $2
  AND NOT cancellation_requested
  AND ((state IN ('delayed', 'ready') AND available_at <= pg_catalog.transaction_timestamp())
    OR (state = 'running' AND lease_expires_at <= pg_catalog.transaction_timestamp()))
FOR UPDATE SKIP LOCKED`,
							[input.application, request.runId],
						);
						if (!row) return Object.freeze({ status: "skipped" as const });
						const resource = durableText(row.resource, "Resource Identity");
						const executableDigest = durableText(
							row.executableDigest,
							"executable digest",
						);
						const reaction = input.reactions.byIdentity.get(resource);
						if (!reaction || reaction.contractDigest !== executableDigest)
							return Object.freeze({
								status: "refused" as const,
								code: "EXECUTABLE_RETIRED" as const,
							});
						const attemptNumber =
							durableInteger(row.attemptCount, "attempt count") + 1;
						const retry = decodeRetryBytes(row.retryBytes);
						if (attemptNumber > retry.maximumAttempts) {
							const staleAttempts = await query(
								`UPDATE questpie_internal.durable_attempts
SET outcome = 'failed', failure_code = 'RETRY_EXHAUSTED'
WHERE application_name = $1 AND run_id = $2 AND outcome IS NULL
RETURNING attempt_id::text AS "attemptId", lease_token_digest AS "leaseTokenDigest"`,
								[input.application, request.runId],
							);
							await query(
								`UPDATE questpie_internal.durable_runs
SET state = 'failed', current_attempt_id = NULL, lease_token_digest = NULL,
    lease_expires_at = NULL, result_bytes = NULL,
    failure_code = 'RETRY_EXHAUSTED', dead_letter = true,
    terminal_at = pg_catalog.transaction_timestamp()
WHERE application_name = $1 AND run_id = $2`,
								[input.application, request.runId],
							);
							const stale = staleAttempts[0];
							await appendEvent(query, {
								application: input.application,
								runId: durableText(row.runId, "run identity"),
								resource,
								dispatchId: durableText(row.dispatchId, "dispatch identity"),
								causationId: durableText(row.causationId, "causation identity"),
								correlationId: durableText(
									row.correlationId,
									"correlation identity",
								),
								kind: "failed",
								attemptId: stale
									? durableText(stale.attemptId, "exhausted attempt identity")
									: null,
								leaseTokenDigest: stale
									? durableText(
											stale.leaseTokenDigest,
											"exhausted lease token digest",
										)
									: null,
								errorCode: "RETRY_EXHAUSTED",
							});
							return Object.freeze({ status: "skipped" as const });
						}
						const attemptId = crypto.randomUUID();
						const leaseToken = crypto.randomUUID();
						const [superseded] = await query(
							`UPDATE questpie_internal.durable_runs
SET state = 'running', attempt_count = $3, current_attempt_id = $4,
    lease_token_digest = $5,
    lease_expires_at = pg_catalog.transaction_timestamp() + make_interval(secs => $6::double precision)
WHERE application_name = $1 AND run_id = $2
RETURNING lease_expires_at AS "leaseExpiresAt",
          pg_catalog.transaction_timestamp() + make_interval(secs => $7::double precision) AS "deadlineAt"`,
							[
								input.application,
								request.runId,
								attemptNumber,
								attemptId,
								leaseTokenDigest(leaseToken),
								leaseMilliseconds / 1_000,
								deadlineMilliseconds / 1_000,
							],
						);
						if (!superseded) throw new TypeError("durable claim lost its run");
						const previous = await query(
							`UPDATE questpie_internal.durable_attempts
SET outcome = 'leaseSuperseded'
WHERE application_name = $1 AND run_id = $2 AND attempt_id <> $3 AND outcome IS NULL
RETURNING attempt_id::text AS "attemptId", lease_token_digest AS "leaseTokenDigest"`,
							[input.application, request.runId, attemptId],
						);
						const leaseExpiresAt = durableDate(
							superseded.leaseExpiresAt,
							"lease expiry",
						);
						const deadlineAt = durableDate(
							superseded.deadlineAt,
							"attempt deadline",
						);
						await query(
							`INSERT INTO questpie_internal.durable_attempts
  (application_name, attempt_id, run_id, attempt_number, worker_id, lease_token_digest,
   lease_expires_at, deadline_at, started_at, heartbeat_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
   pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp())`,
							[
								input.application,
								attemptId,
								request.runId,
								attemptNumber,
								request.workerId,
								leaseTokenDigest(leaseToken),
								leaseExpiresAt,
								deadlineAt,
							],
						);
						const claim = claimRow(row, {
							workerId: request.workerId,
							attemptId,
							attemptNumber,
							leaseToken,
							leaseMilliseconds,
							leaseExpiresAt,
							deadlineAt,
						});
						for (const stale of previous)
							await appendEvent(query, {
								application: input.application,
								runId: claim.runId,
								resource: claim.resource,
								dispatchId: claim.dispatchId,
								causationId: claim.causationId,
								correlationId: claim.correlationId,
								kind: "leaseSuperseded",
								attemptId: durableText(
									stale.attemptId,
									"stale attempt identity",
								),
								leaseTokenDigest: durableText(
									stale.leaseTokenDigest,
									"stale lease token digest",
								),
							});
						await appendEvent(query, {
							application: input.application,
							runId: claim.runId,
							resource: claim.resource,
							dispatchId: claim.dispatchId,
							causationId: claim.causationId,
							correlationId: claim.correlationId,
							kind: "attemptStarted",
							attemptId,
							leaseTokenDigest: leaseTokenDigest(leaseToken),
						});
						return Object.freeze({ status: "claimed" as const, claim });
					},
				);
			} catch (error) {
				if (postgresErrorNumber(error) === "40001")
					return Object.freeze({ status: "skipped" as const });
				throw error;
			}
		},
		async heartbeat(claim) {
			return transaction(async (query) => {
				const [held] = await query(
					`UPDATE questpie_internal.durable_runs
SET lease_expires_at = pg_catalog.transaction_timestamp()
      + make_interval(secs => $5::double precision)
WHERE application_name = $1 AND run_id = $2
  AND current_attempt_id = $3 AND lease_token_digest = $4
RETURNING cancellation_requested AS "cancellationRequested"`,
					[
						input.application,
						claim.runId,
						claim.attemptId,
						leaseTokenDigest(claim.leaseToken),
						claim.leaseMilliseconds / 1_000,
					],
				);
				if (!held)
					return Object.freeze({
						status: "fenced" as const,
						cancellationRequested: false,
						deadlineExpired: false,
					});
				const [attempt] = await query(
					`UPDATE questpie_internal.durable_attempts
SET heartbeat_at = pg_catalog.transaction_timestamp(),
    lease_expires_at = pg_catalog.transaction_timestamp()
      + make_interval(secs => $3::double precision)
WHERE application_name = $1 AND attempt_id = $2
RETURNING deadline_at <= pg_catalog.transaction_timestamp() AS "deadlineExpired"`,
					[input.application, claim.attemptId, claim.leaseMilliseconds / 1_000],
				);
				return Object.freeze({
					status: "held" as const,
					cancellationRequested: held.cancellationRequested === true,
					deadlineExpired: attempt?.deadlineExpired === true,
				});
			});
		},
		succeed(claim, resultBytes) {
			return terminal(claim, "succeeded", {
				state: "succeeded",
				failureCode: null,
				resultBytes,
				deadLetter: false,
				eventKind: "succeeded",
			});
		},
		fail(claim, failure) {
			const exhausted = claim.attemptNumber >= claim.retry.maximumAttempts;
			if (permanentFailureCodes.has(failure.code) || exhausted)
				return terminal(claim, "failed", {
					state: "failed",
					failureCode: permanentFailureCodes.has(failure.code)
						? failure.code
						: "RETRY_EXHAUSTED",
					resultBytes: null,
					deadLetter: true,
					eventKind: "failed",
				});
			return scheduleRetry(claim, failure.code);
		},
		cancel(claim) {
			return terminal(claim, "cancelled", {
				state: "cancelled",
				failureCode: null,
				resultBytes: null,
				deadLetter: false,
				eventKind: "cancelled",
			});
		},
		async inspect(runId) {
			const [row] = (await input.sql.unsafe(
				`SELECT run_id::text AS "runId", dispatch_id::text AS "dispatchId",
       resource_identity AS "resource", state, attempt_count AS "attemptCount",
       current_attempt_id::text AS "currentAttemptId",
       cancellation_requested AS "cancellationRequested", dead_letter AS "deadLetter",
       failure_code AS "failureCode", result_bytes AS "resultBytes",
       available_at AS "availableAt", terminal_at AS "terminalAt",
       event_sequence AS "version"
FROM questpie_internal.durable_runs
WHERE application_name = $1 AND run_id = $2`,
				[input.application, runId],
			)) as unknown as readonly DurableRow[];
			if (!row) return null;
			return Object.freeze({
				runId: durableText(row.runId, "run identity"),
				version: durableInteger(row.version, "run version"),
				dispatchId: durableText(row.dispatchId, "dispatch identity"),
				resource: durableText(row.resource, "Resource Identity"),
				state: durableText(row.state, "run state") as DurableRunState,
				attemptCount: durableInteger(row.attemptCount, "attempt count"),
				currentAttemptId:
					row.currentAttemptId === null
						? null
						: durableText(row.currentAttemptId, "attempt identity"),
				cancellationRequested: row.cancellationRequested === true,
				deadLetter: row.deadLetter === true,
				failureCode:
					row.failureCode === null
						? null
						: durableText(row.failureCode, "failure code"),
				resultBytes:
					row.resultBytes === null
						? null
						: durableBytes(row.resultBytes, "result"),
				availableAt: durableDate(row.availableAt, "availability"),
				terminalAt:
					row.terminalAt === null
						? null
						: durableDate(row.terminalAt, "terminal time"),
			});
		},
		async events(runId) {
			const rows = (await input.sql.unsafe(
				`SELECT sequence, kind, attempt_id::text AS "attemptId",
       lease_token_digest AS "leaseTokenDigest", error_code AS "errorCode"
FROM questpie_internal.durable_run_events
WHERE application_name = $1 AND run_id = $2
ORDER BY sequence`,
				[input.application, runId],
			)) as unknown as readonly DurableRow[];
			return Object.freeze(
				rows.map((row) =>
					Object.freeze({
						sequence: durableInteger(row.sequence, "event sequence"),
						kind: durableText(row.kind, "event kind"),
						attemptId:
							row.attemptId === null
								? null
								: durableText(row.attemptId, "attempt identity"),
						leaseTokenDigest:
							row.leaseTokenDigest === null
								? null
								: durableText(row.leaseTokenDigest, "lease token digest"),
						errorCode:
							row.errorCode === null
								? null
								: durableText(row.errorCode, "error code"),
					}),
				),
			);
		},
	});
}
