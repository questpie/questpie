import type { SQL, TransactionSQL } from "bun";

type Database = SQL | TransactionSQL;

export type ActivationState = Readonly<{
	head: Readonly<{
		revision: bigint;
		targetDigest: string;
		activatedAt: string;
	}> | null;
	programs: readonly Readonly<{
		jobId: string;
		programDigest: string;
		lowerBound: string;
		frontierMinute: string;
		activationRevision: bigint;
	}>[];
	ticks: readonly Readonly<{
		jobId: string;
		tickMinute: string;
		acceptedRevision: bigint;
		programDigest: string;
	}>[];
}>;

export type StaticScheduleActivation = Readonly<{
	activate(input: ActivationInput): Promise<ActivationReceipt>;
	produce(input: ProduceInput): Promise<ProduceResult>;
	inspect(input: Readonly<{ applicationId: string }>): Promise<ActivationState>;
}>;

export type ActivationInput = Readonly<{
	applicationId: string;
	expectedRevision: bigint;
	programs: readonly Readonly<{ jobId: string; programDigest: string }>[];
}>;

export type ActivationReceipt = Readonly<{
	requestIdentity: string;
	acceptedRevision: bigint;
	activatedAt: string;
	currentHead: NonNullable<ActivationState["head"]>;
	replayed: boolean;
}>;

export type ProduceInput = Readonly<{
	applicationId: string;
	expectedRevision: bigint;
	jobId: string;
	tickMinute: string;
	signal?: AbortSignal;
}>;

export type ProduceResult =
	| Readonly<{
			status: "accepted" | "duplicate";
			jobId: string;
			tickMinute: string;
			acceptedRevision: bigint;
			programDigest: string;
	  }>
	| Readonly<{
			status: "ineligible";
			reason:
				| "BEFORE_LOWER_BOUND"
				| "BEHIND_FRONTIER"
				| "FUTURE_TICK"
				| "JOB_REMOVED"
				| "STALE_ACTIVATION";
	  }>;

type HeadRow = Readonly<{
	revision: string | number | bigint;
	target_digest: string;
	activated_at: Date | string;
}>;

type ProgramRow = Readonly<{
	job_id: string;
	program_digest: string;
	lower_bound: Date | string;
	frontier_minute: Date | string;
	activation_revision: string | number | bigint;
}>;

type TickRow = Readonly<{
	job_id: string;
	tick_minute: Date | string;
	accepted_revision: string | number | bigint;
	program_digest: string;
}>;

type RequestRow = Readonly<{
	accepted_revision: string | number | bigint;
	activated_at: Date | string;
}>;

type ExistingProgramRow = Readonly<{
	job_id: string;
	program_digest: string;
	lower_bound: Date | string;
	frontier_minute: Date | string;
}>;

type EligibleProgramRow = Readonly<{
	program_digest: string;
	lower_bound: Date | string;
	frontier_minute: Date | string;
}>;

type AcceptedTickRow = Readonly<{
	job_id: string;
	tick_minute: Date | string;
	accepted_revision: string | number | bigint;
	program_digest: string;
}>;

function iso(value: Date | string): string {
	return (value instanceof Date ? value : new Date(value)).toISOString();
}

function revision(value: string | number | bigint, label: string): bigint {
	if (typeof value === "number" && !Number.isSafeInteger(value))
		throw new TypeError(`inexact ${label}`);
	try {
		return BigInt(value);
	} catch {
		throw new TypeError(`invalid ${label}`);
	}
}

function digest(value: string): string {
	return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

function utcMinute(value: string): string {
	const parsed = new Date(value);
	if (
		!Number.isFinite(parsed.getTime()) ||
		parsed.toISOString() !== value ||
		parsed.getUTCSeconds() !== 0 ||
		parsed.getUTCMilliseconds() !== 0
	)
		throw new TypeError("tickMinute must be a canonical UTC minute");
	return value;
}

function canonicalPrograms(input: ActivationInput): readonly Readonly<{
	jobId: string;
	programDigest: string;
}>[] {
	if (
		!input.applicationId ||
		typeof input.expectedRevision !== "bigint" ||
		input.expectedRevision < 0n
	)
		throw new TypeError("invalid activation input");
	const programs = [...input.programs].sort((left, right) =>
		left.jobId < right.jobId ? -1 : left.jobId > right.jobId ? 1 : 0,
	);
	for (const [index, program] of programs.entries()) {
		if (
			!program.jobId ||
			!program.programDigest ||
			programs[index - 1]?.jobId === program.jobId
		)
			throw new TypeError("invalid activation target");
	}
	return programs;
}

function decodeHead(row: HeadRow): NonNullable<ActivationState["head"]> {
	return {
		revision: revision(row.revision, "activation revision"),
		targetDigest: row.target_digest,
		activatedAt: iso(row.activated_at),
	};
}

export function createStaticScheduleActivation(
	database: Database,
	options: Readonly<{ schema: string }>,
): StaticScheduleActivation {
	if (!/^[a-z][a-z0-9_]*$/u.test(options.schema))
		throw new TypeError("invalid proof schema");
	const prefix = `"${options.schema}"`;

	return {
		async activate(input) {
			const programs = canonicalPrograms(input);
			const targetDigest = digest(JSON.stringify(programs));
			const requestIdentity = digest(
				JSON.stringify([
					input.applicationId,
					input.expectedRevision.toString(),
					targetDigest,
				]),
			);

			return database.begin(async (transaction) => {
				await transaction.unsafe(
					"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
					[input.applicationId],
				);
				const historical = await transaction.unsafe<readonly RequestRow[]>(
					`SELECT "accepted_revision", "activated_at"
					 FROM ${prefix}."activation_requests"
					 WHERE "application_id" = $1
					   AND "expected_revision" = $2
					   AND "target_digest" = $3`,
					[input.applicationId, input.expectedRevision, targetDigest],
				);
				const heads = await transaction.unsafe<readonly HeadRow[]>(
					`SELECT "revision", "target_digest", "activated_at"
					 FROM ${prefix}."activation_heads"
					 WHERE "application_id" = $1
					 FOR UPDATE`,
					[input.applicationId],
				);
				const current = heads[0];
				if (historical[0]) {
					if (!current) throw new TypeError("missing activation head");
					return {
						requestIdentity,
						acceptedRevision: revision(
							historical[0].accepted_revision,
							"historical activation revision",
						),
						activatedAt: iso(historical[0].activated_at),
						currentHead: decodeHead(current),
						replayed: true,
					};
				}
				const currentRevision = current
					? revision(current.revision, "activation revision")
					: 0n;
				if (currentRevision !== input.expectedRevision)
					throw new Error("ACTIVATION_STALE");
				if (currentRevision === 9_223_372_036_854_775_807n)
					throw new Error("ACTIVATION_REVISION_OVERFLOW");

				const [clock] = await transaction.unsafe<
					readonly Readonly<{ activated_at: Date | string }>[]
				>(
					"SELECT date_trunc('minute', clock_timestamp(), 'UTC') AS activated_at",
				);
				if (!clock) throw new TypeError("missing activation clock");
				const activatedAt = iso(clock.activated_at);
				const acceptedRevision = currentRevision + 1n;
				const existing = await transaction.unsafe<
					readonly ExistingProgramRow[]
				>(
					`SELECT "job_id", "program_digest", "lower_bound", "frontier_minute"
					 FROM ${prefix}."activation_programs"
					 WHERE "application_id" = $1`,
					[input.applicationId],
				);
				const previousByJob = new Map(existing.map((row) => [row.job_id, row]));

				await transaction.unsafe(
					`INSERT INTO ${prefix}."activation_heads"
					 ("application_id", "revision", "target_digest", "activated_at")
					 VALUES ($1, $2, $3, $4)
					 ON CONFLICT ("application_id") DO UPDATE SET
					   "revision" = EXCLUDED."revision",
					   "target_digest" = EXCLUDED."target_digest",
					   "activated_at" = EXCLUDED."activated_at"`,
					[input.applicationId, acceptedRevision, targetDigest, activatedAt],
				);
				await transaction.unsafe(
					`DELETE FROM ${prefix}."activation_programs"
					 WHERE "application_id" = $1`,
					[input.applicationId],
				);
				for (const program of programs) {
					const previous = previousByJob.get(program.jobId);
					const lowerBound =
						previous?.program_digest === program.programDigest
							? iso(previous.lower_bound)
							: activatedAt;
					const frontierMinute =
						previous?.program_digest === program.programDigest
							? iso(previous.frontier_minute)
							: activatedAt;
					await transaction.unsafe(
						`INSERT INTO ${prefix}."activation_programs"
						 ("application_id", "job_id", "program_digest", "lower_bound", "frontier_minute", "activation_revision")
						 VALUES ($1, $2, $3, $4, $5, $6)`,
						[
							input.applicationId,
							program.jobId,
							program.programDigest,
							lowerBound,
							frontierMinute,
							acceptedRevision,
						],
					);
				}
				await transaction.unsafe(
					`INSERT INTO ${prefix}."activation_requests"
					 ("application_id", "expected_revision", "target_digest", "accepted_revision", "activated_at")
					 VALUES ($1, $2, $3, $4, $5)`,
					[
						input.applicationId,
						input.expectedRevision,
						targetDigest,
						acceptedRevision,
						activatedAt,
					],
				);
				const currentHead = {
					revision: acceptedRevision,
					targetDigest,
					activatedAt,
				};
				return {
					requestIdentity,
					acceptedRevision,
					activatedAt,
					currentHead,
					replayed: false,
				};
			});
		},
		async produce(input) {
			if (
				!input.applicationId ||
				!input.jobId ||
				typeof input.expectedRevision !== "bigint" ||
				input.expectedRevision < 1n
			)
				throw new TypeError("invalid producer input");
			const tickMinute = utcMinute(input.tickMinute);
			if (input.signal?.aborted) throw input.signal.reason;

			return database.begin(async (transaction) => {
				const heads = await transaction.unsafe<readonly HeadRow[]>(
					`SELECT "revision", "target_digest", "activated_at"
					 FROM ${prefix}."activation_heads"
					 WHERE "application_id" = $1
					 FOR UPDATE`,
					[input.applicationId],
				);
				const head = heads[0];
				if (
					!head ||
					revision(head.revision, "producer activation revision") !==
						input.expectedRevision
				)
					return { status: "ineligible", reason: "STALE_ACTIVATION" };
				const eligible = await transaction.unsafe<
					readonly EligibleProgramRow[]
				>(
					`SELECT "program_digest", "lower_bound", "frontier_minute"
					 FROM ${prefix}."activation_programs"
					 WHERE "application_id" = $1 AND "job_id" = $2`,
					[input.applicationId, input.jobId],
				);
				const program = eligible[0];
				if (!program) return { status: "ineligible", reason: "JOB_REMOVED" };
				const [existing] = await transaction.unsafe<readonly AcceptedTickRow[]>(
					`SELECT "job_id", "tick_minute", "accepted_revision", "program_digest"
					 FROM ${prefix}."accepted_ticks"
					 WHERE "application_id" = $1 AND "job_id" = $2 AND "tick_minute" = $3`,
					[input.applicationId, input.jobId, tickMinute],
				);
				if (input.signal?.aborted) throw input.signal.reason;
				if (existing)
					return {
						status: "duplicate",
						jobId: existing.job_id,
						tickMinute: iso(existing.tick_minute),
						acceptedRevision: revision(
							existing.accepted_revision,
							"existing tick revision",
						),
						programDigest: existing.program_digest,
					};
				if (Date.parse(tickMinute) <= Date.parse(iso(program.lower_bound)))
					return { status: "ineligible", reason: "BEFORE_LOWER_BOUND" };
				if (Date.parse(tickMinute) <= Date.parse(iso(program.frontier_minute)))
					return { status: "ineligible", reason: "BEHIND_FRONTIER" };
				const [clock] = await transaction.unsafe<
					readonly Readonly<{ current_minute: Date | string }>[]
				>(
					"SELECT date_trunc('minute', clock_timestamp(), 'UTC') AS current_minute",
				);
				if (!clock) throw new TypeError("missing producer clock");
				if (Date.parse(tickMinute) > Date.parse(iso(clock.current_minute)))
					return { status: "ineligible", reason: "FUTURE_TICK" };
				if (input.signal?.aborted) throw input.signal.reason;

				const inserted = await transaction.unsafe<readonly AcceptedTickRow[]>(
					`INSERT INTO ${prefix}."accepted_ticks"
					 ("application_id", "job_id", "tick_minute", "accepted_revision", "program_digest", "accepted_at")
					 VALUES ($1, $2, $3, $4, $5, clock_timestamp())
					 ON CONFLICT ("application_id", "job_id", "tick_minute") DO NOTHING
					 RETURNING "job_id", "tick_minute", "accepted_revision", "program_digest"`,
					[
						input.applicationId,
						input.jobId,
						tickMinute,
						input.expectedRevision,
						program.program_digest,
					],
				);
				const receiptRows =
					inserted.length === 1
						? inserted
						: await transaction.unsafe<readonly AcceptedTickRow[]>(
								`SELECT "job_id", "tick_minute", "accepted_revision", "program_digest"
								 FROM ${prefix}."accepted_ticks"
								 WHERE "application_id" = $1 AND "job_id" = $2 AND "tick_minute" = $3`,
								[input.applicationId, input.jobId, tickMinute],
							);
				const receipt = receiptRows[0];
				if (!receipt) throw new TypeError("missing accepted tick receipt");
				await transaction.unsafe(
					`UPDATE ${prefix}."activation_programs"
					 SET "frontier_minute" = GREATEST("frontier_minute", $3::timestamptz)
					 WHERE "application_id" = $1 AND "job_id" = $2`,
					[input.applicationId, input.jobId, tickMinute],
				);
				if (input.signal?.aborted) throw input.signal.reason;
				return {
					status: inserted.length === 1 ? "accepted" : "duplicate",
					jobId: receipt.job_id,
					tickMinute: iso(receipt.tick_minute),
					acceptedRevision: revision(
						receipt.accepted_revision,
						"tick receipt revision",
					),
					programDigest: receipt.program_digest,
				};
			});
		},
		async inspect({ applicationId }) {
			const heads = await database.unsafe<readonly HeadRow[]>(
				`SELECT "revision", "target_digest", "activated_at"
					 FROM ${prefix}."activation_heads"
					 WHERE "application_id" = $1`,
				[applicationId],
			);
			const programs = await database.unsafe<readonly ProgramRow[]>(
				`SELECT "job_id", "program_digest", "lower_bound", "frontier_minute", "activation_revision"
					 FROM ${prefix}."activation_programs"
					 WHERE "application_id" = $1
					 ORDER BY "job_id"`,
				[applicationId],
			);
			const ticks = await database.unsafe<readonly TickRow[]>(
				`SELECT "job_id", "tick_minute", "accepted_revision", "program_digest"
					 FROM ${prefix}."accepted_ticks"
					 WHERE "application_id" = $1
					 ORDER BY "job_id", "tick_minute"`,
				[applicationId],
			);
			const head = heads[0];
			return {
				head: head ? decodeHead(head) : null,
				programs: programs.map((program) => ({
					jobId: program.job_id,
					programDigest: program.program_digest,
					lowerBound: iso(program.lower_bound),
					frontierMinute: iso(program.frontier_minute),
					activationRevision: revision(
						program.activation_revision,
						"program activation revision",
					),
				})),
				ticks: ticks.map((tick) => ({
					jobId: tick.job_id,
					tickMinute: iso(tick.tick_minute),
					acceptedRevision: revision(
						tick.accepted_revision,
						"tick activation revision",
					),
					programDigest: tick.program_digest,
				})),
			};
		},
	};
}
