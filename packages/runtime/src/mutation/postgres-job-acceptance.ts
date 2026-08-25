import type { JobAcceptanceRecord, JobAcceptanceTransaction } from "../durable";
import type { PostgresTransaction } from "../postgres/contract";
import type { LinkedPostgresMutationTransactionStatement } from "./postgres-transaction-statements";
import type { LinkedPostgresMutationTransactionStatements } from "./postgres-transaction-statements";

const statementIdentities = [
	"mutation.dispatch.accept",
	"mutation.dispatch.event.insert",
	"mutation.dispatch.kernel.mark",
	"mutation.dispatch.run.insert",
	"mutation.job.acceptance.claim",
	"mutation.job.acceptance.read",
] as const;

type StatementIdentity = (typeof statementIdentities)[number];

async function requireMarker(
	transaction: PostgresTransaction,
	statement: LinkedPostgresMutationTransactionStatement,
): Promise<void> {
	const marker = await transaction.execute(statement.statement, []);
	if (marker[0]?.enabled !== "on")
		throw new TypeError("Durable kernel transaction marker is unavailable");
}

/** Persists one normalized Job acceptance in an explicit or Mutation-owned transaction. */
export function createPostgresJobAcceptanceTransaction(
	input: Readonly<{
		transaction: PostgresTransaction;
		statements: LinkedPostgresMutationTransactionStatements;
		application: string;
		sourceOperation: string;
		callId: string;
	}>,
): JobAcceptanceTransaction {
	const statements = Object.freeze(
		Object.fromEntries(
			statementIdentities.map((identity) => {
				const statement = input.statements.get(identity);
				if (!statement || statement.identity !== identity)
					throw new TypeError(
						"PostgreSQL Job acceptance statements are incomplete",
					);
				return [identity, statement] as const;
			}),
		),
	) as Readonly<
		Record<StatementIdentity, LinkedPostgresMutationTransactionStatement>
	>;
	return Object.freeze({
		accept: async (record: JobAcceptanceRecord) => {
			await requireMarker(
				input.transaction,
				statements["mutation.dispatch.kernel.mark"],
			);
			const claimed = await input.transaction.execute(
				statements["mutation.job.acceptance.claim"].statement,
				[
					input.application,
					record.tenantId,
					input.sourceOperation,
					record.principal.kind,
					record.principal.id,
					input.callId,
					record.dispatchId,
					record.dispatchId,
					"job",
					record.resource,
					record.requestDigest,
					record.payloadBytes,
					record.acceptedAt,
				],
			);
			if (claimed.length === 0) {
				const existing = await input.transaction.execute(
					statements["mutation.job.acceptance.read"].statement,
					[input.application, record.dispatchId],
				);
				const requestDigest = existing[0]?.requestDigest;
				if (existing.length !== 1 || typeof requestDigest !== "string")
					throw new TypeError(
						"Job acceptance is unavailable after identity conflict",
					);
				return Object.freeze({
					status: "existing" as const,
					requestDigest,
				});
			}
			if (claimed.length !== 1 || claimed[0]!.dispatchId !== record.dispatchId)
				throw new TypeError("Job acceptance claim did not advance");
			await requireMarker(
				input.transaction,
				statements["mutation.dispatch.kernel.mark"],
			);
			const advanced = await input.transaction.execute(
				statements["mutation.dispatch.accept"].statement,
				[input.application, record.dispatchId],
			);
			if (
				advanced.length !== 1 ||
				advanced[0]!.dispatchId !== record.dispatchId
			)
				throw new TypeError("Job acceptance did not advance");
			const inserted = await input.transaction.execute(
				statements["mutation.dispatch.run.insert"].statement,
				[
					input.application,
					record.runId,
					record.dispatchId,
					record.resource,
					record.semanticVersion,
					record.tenantId,
					record.principal.kind,
					record.principal.id,
					record.contextInputBytes,
					record.payloadBytes,
					record.retryBytes,
					record.runtimeBuildDigest,
					record.executableDigest,
					record.causationKind,
					record.causationId,
					record.correlationId,
					record.state,
					record.availableAt,
					record.horizonAt,
					record.acceptedAt,
				],
			);
			if (inserted.length !== 1 || inserted[0]!.runId !== record.runId)
				throw new TypeError("Job acceptance run did not advance");
			await input.transaction.execute(
				statements["mutation.dispatch.event.insert"].statement,
				[
					input.application,
					record.runId,
					record.acceptedAt,
					record.resource,
					record.dispatchId,
					record.causationId,
					record.correlationId,
				],
			);
			return Object.freeze({ status: "accepted" as const });
		},
	});
}
