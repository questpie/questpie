import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { SQL } from "bun";
import { principal } from "questpie";

import type { ExecutionFacts } from "../../../packages/runtime/src/execution";
import { linkReactionProjection } from "../../../packages/runtime/src/mutation";
import { createPostgresDatabaseMutationInvoker } from "../../../packages/runtime/src/mutation/postgres-database";
import type { PreparedOperation } from "../../../packages/runtime/src/operation";
import type {
	PostgresTransaction,
	PostgresTransactionRunner,
} from "../../../packages/runtime/src/postgres/contract";
const postgres = process.env.PGHOST ? test : test.skip;
const fixtureRoot = resolve(import.meta.dir, "../../../fixtures/collaboration");
const generatedRoot = resolve(fixtureRoot, ".questpie/generated");
const beta05Ids = Object.freeze({
	company: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
	space: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a1",
	channel: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2",
	membership: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3",
	principal: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
});

function postgresUrl(): string {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.toString();
}

async function prepareSchema(): Promise<void> {
	const helper = new URL("./helpers/beta05-runtime.ts", import.meta.url).href;
	const script = `
import { SQL } from "bun";
import { beta05PostgresUrl, prepareBeta05PostgresApplication } from ${JSON.stringify(helper)};
const database = new SQL(beta05PostgresUrl());
try {
  const prepared = await prepareBeta05PostgresApplication(database);
  await prepared.dispose();
} finally {
  await database.close({ timeout: 2 });
}`;
	const child = Bun.spawn([process.execPath, "-e", script], {
		env: process.env,
		stdout: "inherit",
		stderr: "inherit",
	});
	if ((await child.exited) !== 0)
		throw new Error("failed to prepare PostgreSQL Mutation fixture");
}

async function generatedFiles(names: readonly string[]) {
	return Object.fromEntries(
		await Promise.all(
			names.map(async (name) => [
				name,
				await readFile(resolve(generatedRoot, name), "utf8"),
			]),
		),
	);
}

type View = Readonly<{
	data: Readonly<{
		messages: Readonly<{
			create(input: unknown): Promise<Readonly<Record<string, unknown>>>;
		}>;
		messageEvents: Readonly<{
			create(input: unknown): Promise<Readonly<Record<string, unknown>>>;
		}>;
	}>;
	dispatch: Readonly<{
		messagePublished(input: unknown): Promise<void>;
	}>;
}>;

function operation(
	body: string,
	onHandler: () => void,
): PreparedOperation<View> {
	return {
		admission: "authenticated",
		binding: {
			identity: "mutation:message.publish.database",
			kind: "mutation",
			slot: "handler",
			runtimeGraphDigest: "a".repeat(64),
			bundleExport: "publishDatabase",
			async execute({ input, ctx }) {
				onHandler();
				const message = await ctx.data.messages.create({
					input: {
						channelId: beta05Ids.channel,
						authorMembershipId: beta05Ids.membership,
						body: (input as { body: string }).body,
					},
				});
				await ctx.data.messageEvents.create({
					input: { messageId: message.id, kind: "published" },
				});
				await ctx.dispatch.messagePublished({
					channelId: beta05Ids.channel,
					companyId: beta05Ids.company,
					messageId: message.id,
				});
				return message;
			},
			definition: {
				name: "message.publish.database",
				handler: () => undefined,
				errors: {},
			},
		},
		inputCodec: {
			kind: "object",
			properties: { body: { kind: "text" } },
		},
		output: {
			kind: "object",
			properties: {
				id: { kind: "uuid" },
				channelId: { kind: "uuid" },
				body: { kind: "text" },
				createdAt: { kind: "timestamp" },
			},
		},
		declaredErrors: [],
		input: { body },
	} as unknown as PreparedOperation<View>;
}

function configuration() {
	const url = postgresUrl();
	return {
		connectionUrl: url,
		directConnectionUrl: url,
		pool: {
			max: 2,
			connectTimeoutMs: 2_000,
			checkoutTimeoutMs: 2_000,
			idleTimeoutMs: 2_000,
			maxLifetimeSeconds: 60,
		},
		timeouts: {
			statementMs: 5_000,
			lockMs: 2_000,
			idleInTransactionMs: 5_000,
		},
	} as const;
}

postgres(
	"commits, replays, conflicts, and rolls back one static database Mutation atomically",
	async () => {
		await prepareSchema();
		const generated = await generatedFiles([
			"postgres-collection-operation-plans.json",
			"postgres-mutation-transaction-statements.json",
			"policy-projection.json",
			"runtime-build.json",
			"collection-operation-programs.json",
			"field-normalizer-programs.json",
			"server-value-programs.json",
			"reaction-projection.json",
		]);
		const collectionArtifact = JSON.parse(
			generated["postgres-collection-operation-plans.json"]!,
		) as Readonly<{ digest: string }>;
		const fixedArtifact = JSON.parse(
			generated["postgres-mutation-transaction-statements.json"]!,
		) as Readonly<{ digest: string }>;
		const policyProjection = JSON.parse(
			generated["policy-projection.json"]!,
		) as Readonly<{
			policies: readonly Readonly<{
				program: Readonly<{ identity: string; target: string }>;
			}>[];
		}>;
		const runtimeBuild = JSON.parse(
			generated["runtime-build.json"]!,
		) as Readonly<{ digest: string }>;
		const mutation = await import("../../../packages/runtime/src/mutation");
		const { createRuntimePostgres } =
			await import("../../../packages/runtime/src/postgres");
		const operations = mutation.linkCollectionMutationPrograms({
			collectionOperations: JSON.parse(
				generated["collection-operation-programs.json"]!,
			),
			fieldNormalizers: JSON.parse(
				generated["field-normalizer-programs.json"]!,
			),
			serverValues: JSON.parse(generated["server-value-programs.json"]!),
			policies: policyProjection.policies.map(({ program }) => ({
				identity: program.identity,
				target: program.target,
			})),
		});
		const collectionPlans = mutation.linkPostgresCollectionOperationPlans({
			artifact: collectionArtifact,
			operations,
			expectedDigest: collectionArtifact.digest,
		});
		const transactionStatements =
			mutation.linkPostgresMutationTransactionStatements({
				artifact: generated["postgres-mutation-transaction-statements.json"]!,
				expectedDigest: fixedArtifact.digest,
			});
		const receiptCommitStatement = transactionStatements.get(
			"mutation.receipt.commit",
		)!.statement;
		const reactions = linkReactionProjection(
			JSON.parse(generated["reaction-projection.json"]!),
		);
		const database = createRuntimePostgres(configuration());
		const facts = {
			principal: principal.user({ id: beta05Ids.principal }),
			authority: { kind: "ordinary" as const },
			tenant: { id: beta05Ids.company },
			values: { selectedMembershipId: beta05Ids.membership },
			contextInput: { companyId: beta05Ids.company },
			liveQueryObservation: null,
			signal: new AbortController().signal,
			deadline: null,
		} satisfies ExecutionFacts<
			Readonly<{
				tenant: Readonly<{ id: string }>;
				values: Readonly<{ selectedMembershipId: string }>;
			}>
		>;
		let handlerCalls = 0;
		const createInvoker = (runner: PostgresTransactionRunner) =>
			createPostgresDatabaseMutationInvoker<View>({
				database: runner,
				application: "application:collaboration",
				transactionStatements,
				collectionPlans,
				reactions,
				contextInputCodec: {
					kind: "object",
					properties: { companyId: { kind: "uuid" } },
				},
				runtimeBuildDigest: runtimeBuild.digest,
				facts,
			});
		const invoke = createInvoker(database);
		const callId = `pb05-db-${crypto.randomUUID()}`;
		const body = `database-${crypto.randomUUID()}`;
		let committed: Awaited<ReturnType<typeof invoke>> | undefined;
		let rollbackCall = "";
		let rollbackBody = "";
		try {
			committed = await invoke(
				operation(body, () => (handlerCalls += 1)),
				callId,
			);
			expect(committed.committed).toBe(true);
			expect(committed.value).toMatchObject({ body });
			await expect(
				invoke(
					operation(body, () => (handlerCalls += 1)),
					callId,
				),
			).resolves.toEqual(committed);
			await expect(
				invoke(
					operation(`${body}-changed`, () => (handlerCalls += 1)),
					callId,
				),
			).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
			expect(handlerCalls).toBe(1);

			let faultCalls = 0;
			const faulting: PostgresTransactionRunner = {
				transaction: (input) =>
					database.transaction({
						...input,
						use: (transaction) =>
							input.use({
								...transaction,
								async execute(statement, value) {
									if (statement === receiptCommitStatement) {
										faultCalls += 1;
										throw new TypeError("forced receipt refusal");
									}
									return transaction.execute(statement, value);
								},
							} as PostgresTransaction),
					}),
			};
			rollbackCall = `pb05-rollback-${crypto.randomUUID()}`;
			rollbackBody = `rollback-${crypto.randomUUID()}`;
			await expect(
				createInvoker(faulting)(
					operation(rollbackBody, () => (handlerCalls += 1)),
					rollbackCall,
				),
			).rejects.toThrow("forced receipt refusal");
			expect(handlerCalls).toBe(2);
			expect(faultCalls).toBe(1);
		} finally {
			await database.close({ deadlineAt: Date.now() + 5_000 });
		}

		const verify = new SQL(postgresUrl());
		try {
			if (!committed) throw new Error("committed result is unavailable");
			const messageId = (committed.value as { id: string }).id;
			const [counts] = await verify.unsafe(
				`SELECT
  (SELECT count(*)::int FROM collaboration.messages WHERE id = $1) AS messages,
  (SELECT count(*)::int FROM collaboration.message_events WHERE message_id = $1) AS audits,
  (SELECT count(*)::int FROM questpie_internal.mutation_call_receipts WHERE call_id = $2) AS receipts,
  (SELECT count(*)::int FROM questpie_internal.pending_reaction_intents WHERE call_id = $2) AS intents,
  (SELECT count(*)::int FROM questpie_internal.durable_runs WHERE dispatch_id IN (SELECT record_id FROM questpie_internal.pending_reaction_intents WHERE call_id = $2)) AS runs,
  (SELECT count(*)::int FROM questpie_internal.durable_run_events WHERE run_id IN (SELECT run_id FROM questpie_internal.durable_runs WHERE dispatch_id IN (SELECT record_id FROM questpie_internal.pending_reaction_intents WHERE call_id = $2))) AS events`,
				[messageId, callId],
			);
			expect(counts).toEqual({
				messages: 1,
				audits: 1,
				receipts: 1,
				intents: 1,
				runs: 1,
				events: 1,
			});
			const [rolledBack] = await verify.unsafe(
				`SELECT
				  (SELECT count(*)::int FROM collaboration.messages WHERE body = $1) AS messages,
				  (SELECT count(*)::int FROM collaboration.message_events e JOIN collaboration.messages m ON m.id = e.message_id WHERE m.body = $1) AS audits,
				  (SELECT count(*)::int FROM questpie_internal.mutation_call_receipts WHERE call_id = $2) AS receipts,
				  (SELECT count(*)::int FROM questpie_internal.pending_reaction_intents WHERE call_id = $2) AS intents,
				  (SELECT count(*)::int FROM questpie_internal.durable_runs r JOIN questpie_internal.pending_reaction_intents i ON i.record_id = r.dispatch_id WHERE i.call_id = $2) AS runs,
				  (SELECT count(*)::int FROM questpie_internal.durable_run_events e JOIN questpie_internal.durable_runs r ON r.run_id = e.run_id JOIN questpie_internal.pending_reaction_intents i ON i.record_id = r.dispatch_id WHERE i.call_id = $2) AS events`,
				[rollbackBody, rollbackCall],
			);
			expect(rolledBack).toEqual({
				messages: 0,
				audits: 0,
				receipts: 0,
				intents: 0,
				runs: 0,
				events: 0,
			});
		} finally {
			await verify.close({ timeout: 2 });
		}
	},
	30_000,
);
