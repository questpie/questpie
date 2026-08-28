import type { Pool, PoolClient } from "pg";

import {
	InterpretedIssue,
	artifactDigest,
	compileArtifact,
	createExecutionBudget,
	encodeArtifact,
	executePhase,
	loadArtifact,
	type Artifact,
	type Bindings,
	type Identity,
	type OperationAdapter,
} from "../compiler-artifact/compiler";

const issueBrand = Symbol("collection-lifecycle-issue");
const admittedCallBrand = Symbol("compiler-admitted-operation-call");

export type IssueIdentity = `collection:${string}/issue:${string}`;

export type DeclaredErrorMetadata = Readonly<{
	code: string;
	payload: "none" | "required";
}>;

export type AdmittedOperationCall = Readonly<{
	identity: string;
	[admittedCallBrand]: true;
	mapIssue: (identity: IssueIdentity) => string | undefined;
}>;

export type PublicFailure = Readonly<{
	kind: "declared" | "framework";
	code: string;
	retryable: false;
}>;

export type ProofOutcome =
	| Readonly<{
			ok: true;
			result: Readonly<Record<string, unknown>>;
			transactionId: string;
			now: string;
			replayed: boolean;
	  }>
	| Readonly<{
			ok: false;
			error: PublicFailure;
			bytes: Uint8Array;
			classification:
				| "collectionIssue"
				| "postgresConstraint"
				| "internal"
				| "cancelled"
				| "deadline"
				| "limit";
	  }>;

export type ProofTrace = {
	events: string[];
	lifecycleRuns: number;
	transactionIds: string[];
};

export type ExecuteInput = Readonly<{
	callId: string;
	ticketId: string;
	caller: Readonly<Record<string, unknown>>;
	trusted: Readonly<Record<string, unknown>>;
	call: AdmittedOperationCall;
	catchIssue?: boolean;
	fault?:
		| "unknown"
		| "forged"
		| "malformed"
		| "unmapped"
		| "cancel"
		| "deadline";
	maxStatements?: number;
	maxRows?: number;
	maxDependencies?: number;
	nestedDepth?: number;
	maxReentry?: number;
	cancelAtOrdinal?: number;
}>;

type InternalFailure = Error & {
	readonly classification:
		| "postgresConstraint"
		| "internal"
		| "cancelled"
		| "deadline"
		| "limit";
};

class CollectionIssue extends Error {
	readonly [issueBrand] = true;

	constructor(readonly identity: IssueIdentity) {
		super("Collection lifecycle issue");
	}
}

function internalFailure(
	classification: InternalFailure["classification"],
): InternalFailure {
	return Object.assign(new Error("operation failed"), { classification });
}

function isCollectionIssue(error: unknown): error is CollectionIssue {
	return (
		error instanceof CollectionIssue &&
		error[issueBrand] === true &&
		/^collection:[a-z][a-z0-9-]*\/issue:[a-z][A-Za-z0-9]*$/.test(error.identity)
	);
}

function publicBytes(error: PublicFailure): Uint8Array {
	return new TextEncoder().encode(JSON.stringify({ ok: false, error }));
}

function codec(
	candidate: Readonly<Record<string, unknown>>,
	trace: ProofTrace,
) {
	trace.events.push("codec");
	if (
		typeof candidate.title !== "string" ||
		typeof candidate.status !== "string" ||
		typeof candidate.secret !== "string"
	)
		throw internalFailure("internal");
}

const emptyTitle = "collection:tickets/issue:emptyTitle" as const;
const forbiddenTitle = "collection:tickets/issue:forbiddenTitle" as const;
const unmappedIssue = "collection:tickets/issue:unmapped" as const;

export const ticketIssues = Object.freeze({
	emptyTitle,
	forbiddenTitle,
	unmappedIssue,
});

const artifactIssueIdentities = Object.freeze({
	emptyTitle: "issue:tickets/emptyTitle",
	forbiddenTitle: "issue:tickets/forbiddenTitle",
} satisfies Readonly<Record<string, Identity>>);

const artifactBindings = Object.freeze({
	schema: "schema:lifecycle-proof",
	collection: "collection:lifecycle-proof/tickets",
	fields: Object.freeze({
		id: "field:lifecycle-proof/tickets/id",
		title: "field:lifecycle-proof/tickets/title",
		status: "field:lifecycle-proof/tickets/status",
		secret: "field:lifecycle-proof/tickets/secret",
		nestedDepth: "field:lifecycle-proof/tickets/nestedDepth",
		ticketId: "field:lifecycle-proof/tickets/ticketId",
		ordinal: "field:lifecycle-proof/tickets/ordinal",
	}),
	issues: artifactIssueIdentities,
	capabilities: Object.freeze({
		"data.forbidden.first": Object.freeze({
			kind: "read",
			identity: "operation:lifecycle-proof/forbidden/first",
			argumentKeys: ["title"],
			cardinality: "one",
			first: true,
			maxRows: 1,
		}),
		"data.audit.plan": Object.freeze({
			kind: "read",
			identity: "operation:lifecycle-proof/audit/plan",
			argumentKeys: ["ticketId", "nestedDepth"],
			cardinality: "many",
			first: false,
			maxRows: 8,
		}),
		"data.audit.create": Object.freeze({
			kind: "write",
			identity: "operation:lifecycle-proof/audit/create",
			argumentKeys: ["ticketId", "ordinal"],
		}),
		"jobs.ticket.notify.accept": Object.freeze({
			kind: "acceptJob",
			identity: "job:lifecycle-proof/ticket/notify",
			argumentKeys: ["ticketId", "callId"],
		}),
	}),
	operations: Object.freeze([
		"operation:lifecycle-proof/forbidden/first",
		"operation:lifecycle-proof/audit/plan",
		"operation:lifecycle-proof/audit/create",
	]),
	jobs: Object.freeze(["job:lifecycle-proof/ticket/notify"]),
} satisfies Bindings);

const runtimeBuild = "7".repeat(64);

function compileAndLoadLifecycleArtifact(): Artifact {
	const compiled = compileArtifact({
		bindings: artifactBindings,
		runtimeBuild,
		reentryLimit: 4,
		callbacks: {
			normalize: `({ input }) => input`,
			validate: `({ candidate, issues }) => {
				if (candidate.title === "") throw issues.emptyTitle();
				if (candidate.title === "forbidden" || candidate.status === "also-invalid") throw issues.forbiddenTitle();
				return candidate;
			}`,
			check: `async ({ candidate, ctx, issues }) => {
				const forbidden = await ctx.data.forbidden.first({ title: candidate.title });
				if (forbidden !== null) throw issues.forbiddenTitle();
				return candidate;
			}`,
			afterWrite: `async ({ row, ctx }) => {
				const planned = await ctx.data.audit.plan({ ticketId: row.id, nestedDepth: row.nestedDepth });
				for (const item of planned) {
					await ctx.data.audit.create({ ticketId: item.ticketId, ordinal: item.ordinal });
				}
				await ctx.jobs.ticket.notify.accept({ ticketId: row.id, callId: ctx.callId });
				return row;
			}`,
		},
	});
	const bytes = encodeArtifact(compiled);
	return loadArtifact(bytes, artifactDigest(bytes), {
		runtimeBuild,
		bindings: artifactBindings,
	});
}

const lifecycleArtifact = compileAndLoadLifecycleArtifact();

function raise(identity: IssueIdentity, doom: () => void): never {
	doom();
	throw new CollectionIssue(identity);
}

async function rollback(client: PoolClient, trace: ProofTrace): Promise<void> {
	await client.query("ROLLBACK");
	trace.events.push("rollback");
}

export class OperationTransactionProof {
	constructor(
		private readonly pool: Pool,
		private readonly schema: string,
	) {
		if (!/^qp_lifecycle_[a-z0-9_]+$/.test(schema))
			throw new TypeError("unsafe proof schema");
	}

	async execute(input: ExecuteInput, trace: ProofTrace): Promise<ProofOutcome> {
		if (
			input.call[admittedCallBrand] !== true ||
			input.call.identity !== "mutation:tickets.update"
		)
			return this.frameworkFailure("INTERNAL", "internal");
		if ("updatedAt" in input.caller || "updatedAt" in input.trusted)
			return this.frameworkFailure("QP-DATA-023", "internal");

		const replay = await this.pool.query<{
			result: Readonly<Record<string, unknown>>;
			transaction_id: string;
			now: string;
		}>(
			`SELECT result, transaction_id, now::text AS now FROM ${this.schema}.receipts WHERE call_id = $1`,
			[input.callId],
		);
		const receipt = replay.rows[0];
		if (receipt) {
			trace.events.push("committed-replay");
			return {
				ok: true,
				result: receipt.result,
				transactionId: receipt.transaction_id,
				now: receipt.now,
				replayed: true,
			};
		}

		const client = await this.pool.connect();
		let doomedByIssue: IssueIdentity | null = null;
		let doomed = false;
		let began = false;
		const cancellation = new AbortController();
		const budget = createExecutionBudget({
			signal: cancellation.signal,
			deadline:
				input.fault === "deadline" ? Date.now() - 1 : Date.now() + 30_000,
			maxStatements: input.maxStatements ?? 20,
			maxRows: input.maxRows ?? 32,
			maxDependencies: input.maxDependencies ?? 20,
			maxDurationMilliseconds: 30_000,
			maxArtifactReentry: input.maxReentry ?? lifecycleArtifact.reentryLimit,
		});
		const doom = () => {
			doomed = true;
		};
		const spend = () => {
			budget.statements += 1;
			if (budget.statements > budget.maxStatements) {
				doom();
				throw internalFailure("limit");
			}
		};
		const raiseFirst = (identity: IssueIdentity): never =>
			raise(identity, () => {
				doomedByIssue ??= identity;
				doom();
			});
		const runPhase = async (
			phase: "normalize" | "validate" | "check" | "afterWrite",
			inputs: readonly unknown[],
			capabilities: OperationAdapter = {},
		): Promise<unknown> => {
			try {
				return await executePhase(
					lifecycleArtifact,
					phase,
					inputs,
					capabilities,
					budget,
				);
			} catch (error) {
				if (error instanceof InterpretedIssue) {
					if (error.identity === artifactIssueIdentities.emptyTitle)
						raiseFirst(emptyTitle);
					if (error.identity === artifactIssueIdentities.forbiddenTitle)
						raiseFirst(forbiddenTitle);
				}
				if (error instanceof DOMException && error.name === "AbortError") {
					doom();
					throw internalFailure("cancelled");
				}
				if (
					error instanceof Error &&
					/budget|deadline|duration/.test(error.message)
				) {
					doom();
					throw internalFailure(
						error.message.includes("deadline") ? "deadline" : "limit",
					);
				}
				throw error;
			}
		};

		try {
			await client.query("BEGIN");
			began = true;
			trace.events.push("begin");
			const clock = await client.query<{ now: string; transaction_id: string }>(
				"SELECT transaction_timestamp()::text AS now, pg_current_xact_id()::text AS transaction_id",
			);
			spend();
			const { now, transaction_id: transactionId } = clock.rows[0]!;
			trace.transactionIds.push(transactionId);
			trace.lifecycleRuns += 1;

			trace.events.push("normalize:caller");
			const caller = (await runPhase("normalize", [input.caller])) as Readonly<
				Record<string, unknown>
			>;
			trace.events.push("normalize:trusted");
			const trusted = (await runPhase("normalize", [
				input.trusted,
			])) as Readonly<Record<string, unknown>>;
			if (
				JSON.stringify(Object.keys(caller).toSorted()) !==
					JSON.stringify(Object.keys(input.caller).toSorted()) ||
				JSON.stringify(Object.keys(trusted).toSorted()) !==
					JSON.stringify(Object.keys(input.trusted).toSorted())
			)
				throw internalFailure("internal");
			const overlap = Object.keys(caller).find((path) => path in trusted);
			if (overlap) throw internalFailure("internal");
			const candidate = Object.freeze({ ...caller, ...trusted });
			codec(candidate, trace);

			trace.events.push("validate");
			const validate = async () => {
				if (input.fault === "unknown") throw new Error("secret unknown detail");
				if (input.fault === "forged")
					throw { identity: emptyTitle, stack: "secret forged stack" };
				if (input.fault === "malformed")
					throw new CollectionIssue("collection:../issue:bad" as IssueIdentity);
				if (input.fault === "unmapped") raiseFirst(unmappedIssue);
				await runPhase("validate", [candidate, null, now, {}]);
			};
			if (input.catchIssue) {
				try {
					await validate();
				} catch (error) {
					trace.events.push("application-catch");
					if (!isCollectionIssue(error)) throw error;
				}
			} else await validate();
			if (doomedByIssue) throw new CollectionIssue(doomedByIssue);

			trace.events.push("candidate-policy");
			if (candidate.secret === "policy-denied")
				throw internalFailure("internal");
			trace.events.push("check");
			const checkCapabilities: OperationAdapter = {
				"operation:lifecycle-proof/forbidden/first": async ({
					arguments: values,
				}) => {
					const argument = values[0] as Readonly<{ title: unknown }>;
					const selected = await client.query<{
						title: string;
						transaction_id: string;
					}>(
						`SELECT title, pg_current_xact_id()::text AS transaction_id
						 FROM ${this.schema}.forbidden_titles
						 WHERE title = $1 AND visible_to_caller
						 LIMIT 1`,
						[argument.title],
					);
					const selectedRow = selected.rows[0];
					if (selectedRow && selectedRow.transaction_id !== transactionId)
						throw internalFailure("internal");
					trace.events.push("check-policy-read");
					return selectedRow
						? Object.freeze({ title: selectedRow.title })
						: null;
				},
			};
			await runPhase(
				"check",
				[candidate, null, now, {}, {}],
				checkCapabilities,
			);
			trace.events.push("constraint-and-database-values");
			const written = await client.query<{
				id: string;
				title: string;
				status: string;
				updated_at: string;
			}>(
				`INSERT INTO ${this.schema}.tickets (id, title, secret, status, updated_at)
				 VALUES ($1, $2, $3, $4, transaction_timestamp())
				 ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, secret = EXCLUDED.secret,
				 status = EXCLUDED.status, updated_at = transaction_timestamp()
				 RETURNING id::text, title, status, updated_at::text`,
				[input.ticketId, candidate.title, candidate.secret, candidate.status],
			);
			spend();
			const row = written.rows[0]!;
			if (input.fault === "cancel") {
				doom();
				cancellation.abort();
			}
			trace.events.push("afterWrite");
			const afterWriteCapabilities: OperationAdapter = {
				"operation:lifecycle-proof/audit/plan": async ({
					arguments: values,
				}) => {
					const argument = values[0] as Readonly<{
						ticketId: unknown;
						nestedDepth: unknown;
					}>;
					const planned = await client.query<{
						ticketId: string;
						ordinal: number;
					}>(
						`SELECT $1::text AS "ticketId", ordinal
						 FROM generate_series(0, $2::integer) AS ordinal`,
						[argument.ticketId, argument.nestedDepth],
					);
					return planned.rows;
				},
				"operation:lifecycle-proof/audit/create": async ({
					arguments: values,
				}) => {
					const argument = values[0] as Readonly<{
						ticketId: unknown;
						ordinal: unknown;
					}>;
					if (argument.ordinal === input.cancelAtOrdinal) cancellation.abort();
					await runPhase("normalize", [argument]);
					trace.events.push(`nested-write:${String(argument.ordinal)}`);
					await client.query(
						`INSERT INTO ${this.schema}.audit (ticket_id, ordinal, transaction_id)
						 VALUES ($1, $2, pg_current_xact_id()::text)`,
						[argument.ticketId, argument.ordinal],
					);
				},
				"job:lifecycle-proof/ticket/notify": async ({ arguments: values }) => {
					const argument = values[0] as Readonly<{
						ticketId: unknown;
						callId: unknown;
					}>;
					trace.events.push("job-accept");
					await client.query(
						`INSERT INTO ${this.schema}.jobs (id, ticket_id, transaction_id)
						 VALUES ($1, $2, pg_current_xact_id()::text)`,
						[`${String(argument.callId)}:job`, argument.ticketId],
					);
				},
			};
			await runPhase(
				"afterWrite",
				[
					{ ...row, id: row.id, nestedDepth: input.nestedDepth ?? 0 },
					null,
					now,
					{},
					input.callId,
				],
				afterWriteCapabilities,
			);
			if (doomed) throw internalFailure("internal");

			const stableClock = await client.query<{ stable: boolean }>(
				"SELECT transaction_timestamp()::text = $1 AS stable",
				[now],
			);
			spend();
			if (!stableClock.rows[0]?.stable) throw internalFailure("internal");

			const result = Object.freeze({
				id: row.id,
				title: row.title,
				status: row.status,
				updatedAt: row.updated_at,
			});
			trace.events.push("receipt");
			await client.query(
				`INSERT INTO ${this.schema}.receipts (call_id, result, transaction_id, now) VALUES ($1, $2::jsonb, $3, $4::timestamptz)`,
				[input.callId, JSON.stringify(result), transactionId, now],
			);
			spend();
			await client.query("COMMIT");
			trace.events.push("commit");
			return { ok: true, result, transactionId, now, replayed: false };
		} catch (error) {
			if (began) await rollback(client, trace);
			trace.events.push("map");
			if (isCollectionIssue(error)) {
				const code = input.call.mapIssue(error.identity);
				if (code) return this.declaredFailure(code, "collectionIssue");
			}
			const databaseError = error as { code?: unknown };
			if (databaseError.code === "23514")
				return this.frameworkFailure("INTERNAL", "postgresConstraint");
			const classification =
				error instanceof Error && "classification" in error
					? (error as InternalFailure).classification
					: "internal";
			return this.frameworkFailure("INTERNAL", classification);
		} finally {
			client.release();
		}
	}

	private declaredFailure(
		code: string,
		classification: "collectionIssue",
	): ProofOutcome {
		const error = Object.freeze({
			kind: "declared" as const,
			code,
			retryable: false as const,
		});
		return { ok: false, error, bytes: publicBytes(error), classification };
	}

	private frameworkFailure(
		code: string,
		classification: Exclude<
			ProofOutcome & { ok: false },
			{ classification: "collectionIssue" }
		>["classification"],
	): ProofOutcome {
		const error = Object.freeze({
			kind: "framework" as const,
			code,
			retryable: false as const,
		});
		return { ok: false, error, bytes: publicBytes(error), classification };
	}
}

export type ReachabilityNode = Readonly<{
	identity: string;
	issues: readonly IssueIdentity[];
	calls: readonly string[];
}>;

export function compileIssueCapability(
	input: Readonly<{
		operation: string;
		root: string;
		nodes: ReadonlyMap<string, ReachabilityNode>;
		mappings: ReadonlyMap<IssueIdentity, string>;
		declaredErrors: readonly DeclaredErrorMetadata[];
	}>,
):
	| Readonly<{ ok: true; call: AdmittedOperationCall }>
	| Readonly<{
			ok: false;
			code: "QP-COMPOSE-027";
			reason:
				| "invalidIssueDeclaration"
				| "invalidIssueMapping"
				| "missingIssueMapping";
			path: readonly string[];
			issue: IssueIdentity;
			mappedError?: string;
			call?: never;
	  }> {
	const reachable = new Map<IssueIdentity, readonly string[]>();
	const visit = (
		identity: string,
		path: readonly string[],
		visited: ReadonlySet<string>,
	): ReturnType<typeof compileIssueCapability> | null => {
		if (visited.has(identity)) return null;
		const node = input.nodes.get(identity);
		if (!node) throw new TypeError(`unknown reachability node: ${identity}`);
		const nextVisited = new Set(visited).add(identity);
		for (const issue of node.issues) {
			if (!/^collection:[a-z][a-z0-9-]*\/issue:[a-z][A-Za-z0-9]*$/.test(issue))
				return {
					ok: false,
					code: "QP-COMPOSE-027",
					reason: "invalidIssueDeclaration",
					path,
					issue,
				};
			reachable.set(issue, path);
		}
		for (const target of node.calls) {
			const failure = visit(target, [...path, target], nextVisited);
			if (failure) return failure;
		}
		return null;
	};
	const traversalFailure = visit(
		input.root,
		[input.operation, input.root],
		new Set(),
	);
	if (traversalFailure) return traversalFailure;
	for (const [issue, mappedError] of input.mappings) {
		const declarations = input.declaredErrors.filter(
			(error) => error.code === mappedError,
		);
		if (
			!reachable.has(issue) ||
			declarations.length !== 1 ||
			declarations[0]!.payload !== "none"
		)
			return {
				ok: false,
				code: "QP-COMPOSE-027",
				reason: "invalidIssueMapping",
				path: reachable.get(issue) ?? [input.operation, input.root],
				issue,
				mappedError,
			};
	}
	for (const [issue, path] of reachable)
		if (!input.mappings.has(issue))
			return {
				ok: false,
				code: "QP-COMPOSE-027",
				reason: "missingIssueMapping",
				path,
				issue,
			};
	const admittedMappings = new Map(input.mappings);
	return {
		ok: true,
		call: Object.freeze({
			identity: input.operation,
			[admittedCallBrand]: true as const,
			mapIssue: (identity: IssueIdentity) => admittedMappings.get(identity),
		}),
	};
}

export function directFailureBytes(outcome: ProofOutcome): Uint8Array {
	if (outcome.ok) throw new TypeError("expected failure");
	return publicBytes(outcome.error);
}

export function wireFailureBytes(outcome: ProofOutcome): Uint8Array {
	if (outcome.ok) throw new TypeError("expected failure");
	return new TextEncoder().encode(
		JSON.stringify({ ok: false, error: outcome.error }),
	);
}
