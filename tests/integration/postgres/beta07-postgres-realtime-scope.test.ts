import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { SQL } from "bun";
import { principal } from "questpie";

import { backendPid } from "../../../packages/compiler/src/postgres-session";
import { ensureInternalProtocolV3 } from "../../../packages/compiler/src/schema";
import { sha256Digest } from "../../../packages/runtime/src/canonical-json";
import { createPostgresRealtimeScopeStore } from "../../../packages/runtime/src/live-query/postgres-realtime-scope";
import { attachScope as attachScopeStatement } from "../../../packages/runtime/src/live-query/postgres-realtime-scope-statements";
import {
	createPostgresDatabase,
	type PostgresDatabase,
	type PostgresStatement,
} from "../../../packages/runtime/src/postgres";

const databases = process.env.PGHOST
	? [new SQL({ max: 1 }), new SQL({ max: 1 }), new SQL({ max: 1 })]
	: [];
const connectionUrl = (() => {
	const url = new URL("postgres://localhost/postgres");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.href;
})();
function createScopeDatabase(): PostgresDatabase {
	return createPostgresDatabase({
		connectionUrl,
		directConnectionUrl: connectionUrl,
		pool: {
			max: 3,
			connectTimeoutMs: 2_000,
			checkoutTimeoutMs: 2_000,
			idleTimeoutMs: 5_000,
			maxLifetimeSeconds: 60,
		},
		timeouts: {
			statementMs: 10_000,
			lockMs: 1_000,
			idleInTransactionMs: 10_000,
		},
	});
}
const scopeDatabases = process.env.PGHOST
	? [createScopeDatabase(), createScopeDatabase(), createScopeDatabase()]
	: [];
const postgresTest = process.env.PGHOST ? test : test.skip;
const control = { lockTimeoutMs: 1_000, statementTimeoutMs: 10_000 } as const;
const applicationName = "collaboration";
const deploymentDigest = "a".repeat(64);
const nextDeploymentDigest = "b".repeat(64);
const authorityPartitionDigest = "c".repeat(64);
const otherAuthorityPartitionDigest = "d".repeat(64);
const user = principal.user({ id: "user:ada" });
const otherUser = principal.user({ id: "user:grace" });
const queryBytes = new TextEncoder().encode('{"query":"messages.page"}\n');
const inputBytes = new TextEncoder().encode('{"first":20}\n');
const inputDigest = sha256Digest(inputBytes);
const contextInputBytes = new TextEncoder().encode('{"tenant":"tenant:one"}\n');
const resultBytes = new TextEncoder().encode('{"messages":[]}\n');
const dependencyPlanBytes = new TextEncoder().encode('{"tokens":[]}\n');

async function ensure(sql: SQL): Promise<void> {
	const [current] = await sql<{ name: string }[]>`
		select current_database() as name
	`;
	await ensureInternalProtocolV3(
		sql,
		current!.name,
		await backendPid(sql),
		control,
	);
}

function attachInput(scopeIdentity: string) {
	return {
		applicationName,
		scopeIdentity,
		deploymentDigest,
		principal: user,
	} as const;
}

function openInput(scopeIdentity: string, bindingIdentity: string) {
	return {
		...attachInput(scopeIdentity),
		bindingIdentity,
		authorityPartitionDigest,
		queryIdentity: "messages.page",
		queryBytes,
		inputBytes,
		inputDigest,
		contextInputBytes,
		wireVersion: 1,
		resumeRequested: false,
		requestedResumeToken: null,
	} as const;
}

function store(index: number) {
	return createPostgresRealtimeScopeStore({ database: scopeDatabases[index]! });
}

beforeEach(async () => {
	await databases[0]?.unsafe("DROP SCHEMA IF EXISTS questpie_internal CASCADE");
	if (databases[0]) await ensure(databases[0]);
});

afterAll(async () => {
	await databases[0]?.unsafe("DROP SCHEMA IF EXISTS questpie_internal CASCADE");
	await Promise.all(
		databases.map((database) => database.close({ timeout: 0 })),
	);
	await Promise.all(
		scopeDatabases.map((database) =>
			database.close({ deadlineAt: Date.now() + 2_000 }),
		),
	);
});

test("refuses an impossible realtime attachment cardinality", () => {
	expect(() =>
		attachScopeStatement.decode({
			command: "INSERT",
			rowCount: 2,
			rows: [["1"], ["2"]],
		}),
	).toThrow("realtime scope attachment result cardinality is invalid");
});

describe.skipIf(databases.length === 0)(
	"BETA-07 PostgreSQL realtime scope authority",
	() => {
		postgresTest(
			"rolls back scope authority when watch persistence fails after opening",
			async () => {
				const baseDatabase = scopeDatabases[1]!;
				const sabotagedDatabase: PostgresDatabase = {
					facts: () => baseDatabase.facts(),
					close: (input) => baseDatabase.close(input),
					async transaction(request) {
						return baseDatabase.transaction({
							mode: request.mode,
							control: request.control,
							async use(transaction) {
								async function execute<Input, Output>(
									statement: PostgresStatement<Input, Output>,
									value: Input,
								): Promise<Output> {
									const output = await transaction.execute(statement, value);
									if (statement.name === "live-query.realtime-watch-insert")
										throw new Error("sabotaged watch persistence");
									return output;
								}
								const sabotaged = Object.freeze({ ...transaction, execute });
								return request.use(sabotaged);
							},
						});
					},
				};
				const scope = attachInput("scope:rollback");
				const normal = store(0);
				expect(await normal.attachScope(scope)).toEqual({
					status: "attached",
					holderGeneration: 1n,
				});
				await expect(
					createPostgresRealtimeScopeStore({
						database: sabotagedDatabase,
					}).openWatch(openInput("scope:rollback", "binding:rollback")),
				).rejects.toThrow("sabotaged watch persistence");
				const [persisted] = await databases[0]!<
					{ state: string; watches: number }[]
				>`
					select scope.state,
					       count(watch.binding_identity)::integer as watches
					from questpie_internal.realtime_scope_attachments scope
					left join questpie_internal.realtime_watch_bindings watch
					  using (application_name, scope_identity)
					where scope.application_name = ${applicationName}
					  and scope.scope_identity = 'scope:rollback'
					group by scope.state
				`;
				expect(persisted).toEqual({ state: "attached", watches: 0 });
			},
		);

		postgresTest(
			"fences a stale holder after same-Principal deployment takeover",
			async () => {
				const first = store(0);
				const fresh = store(1);
				const scope = attachInput("scope:takeover");
				const firstLease = await first.attachScope(scope);
				expect(firstLease).toEqual({
					status: "attached",
					holderGeneration: 1n,
				});
				expect(
					await first.openWatch(
						openInput("scope:takeover", "binding:takeover"),
					),
				).toEqual({ status: "opened", activeSlot: 1 });

				const freshLease = await fresh.attachScope(scope);
				expect(freshLease).toEqual({
					status: "attached",
					holderGeneration: 2n,
				});
				expect(
					await fresh.scanOpenWatches({ ...scope, holderGeneration: 2n }),
				).toHaveLength(1);
				expect(
					await fresh.attachScope({
						...scope,
						deploymentDigest: nextDeploymentDigest,
					}),
				).toEqual({ status: "unavailable" });
				expect(
					await fresh.attachScope({ ...scope, principal: otherUser }),
				).toEqual({ status: "unavailable" });

				expect(await first.renewScope({ ...scope, holderGeneration: 1n })).toBe(
					false,
				);
				expect(
					await first.scanOpenWatches({ ...scope, holderGeneration: 1n }),
				).toEqual([]);
				expect(
					await first.withdrawScope({ ...scope, holderGeneration: 1n }),
				).toBe(false);
				expect(
					await first.stageGeneration({
						...scope,
						holderGeneration: 1n,
						bindingIdentity: "binding:takeover",
						observedInvalidationGeneration: 1n,
						generation: 1n,
						resumeToken: "stale-holder-token",
						resultBytes,
						dependencyPlanBytes,
						delivery: "initial",
						resetReason: null,
					}),
				).toBe(false);
				expect(await fresh.renewScope({ ...scope, holderGeneration: 2n })).toBe(
					true,
				);
				expect(
					await fresh.scanOpenWatches({ ...scope, holderGeneration: 2n }),
				).toHaveLength(1);
			},
		);

		postgresTest(
			"reattaches a normally withdrawn scope only for the same Principal and deployment",
			async () => {
				const first = store(0);
				const fresh = store(1);
				const scope = attachInput("scope:normal-reconnect");
				expect(await first.attachScope(scope)).toEqual({
					status: "attached",
					holderGeneration: 1n,
				});
				expect(
					await first.openWatch(
						openInput("scope:normal-reconnect", "binding:normal-reconnect"),
					),
				).toEqual({ status: "opened", activeSlot: 1 });

				expect(
					await first.withdrawScope({ ...scope, holderGeneration: 1n }),
				).toBe(true);
				expect(
					await fresh.attachScope({
						...scope,
						deploymentDigest: nextDeploymentDigest,
					}),
				).toEqual({ status: "unavailable" });
				expect(
					await fresh.attachScope({ ...scope, principal: otherUser }),
				).toEqual({ status: "unavailable" });

				expect(await fresh.attachScope(scope)).toEqual({
					status: "attached",
					holderGeneration: 2n,
				});
				expect(
					await fresh.openWatch({
						...openInput("scope:normal-reconnect", "binding:normal-reconnect"),
						resumeRequested: true,
						requestedResumeToken: "opaque.normal-reconnect.token",
					}),
				).toEqual({ status: "opened", activeSlot: 1 });
				expect(
					await fresh.scanOpenWatches({ ...scope, holderGeneration: 2n }),
				).toEqual([
					expect.objectContaining({
						bindingIdentity: "binding:normal-reconnect",
						resumeRequested: true,
						requestedResumeToken: "opaque.normal-reconnect.token",
					}),
				]);
				expect(
					await first.withdrawScope({ ...scope, holderGeneration: 1n }),
				).toBe(false);
			},
		);

		postgresTest(
			"routes attach, open, scan, acknowledgement, and close across instances without reconstructing a Principal",
			async () => {
				const holder = store(0);
				const command = store(1);
				const acknowledger = store(2);
				const attached = await holder.attachScope(attachInput("scope:a"));
				expect(attached).toEqual({
					status: "attached",
					holderGeneration: 1n,
				});
				const lease = {
					...attachInput("scope:a"),
					holderGeneration: 1n,
				} as const;
				expect(await holder.scanOpenWatches(lease)).toEqual([]);

				expect(
					await command.openWatch(openInput("scope:a", "binding:a")),
				).toEqual({
					status: "opened",
					activeSlot: 1,
				});
				const [opened] = await holder.scanOpenWatches(lease);
				expect(opened).toEqual({
					bindingIdentity: "binding:a",
					authorityPartitionDigest,
					queryIdentity: "messages.page",
					queryBytes,
					inputBytes,
					contextInputBytes,
					inputDigest,
					wireVersion: 1,
					resumeRequested: false,
					requestedResumeToken: null,
					activeSlot: 1,
					invalidationGeneration: 1n,
					evaluatedInvalidationGeneration: 0n,
					latest: null,
				});
				expect(Object.hasOwn(opened!, "principal")).toBe(false);
				expect(
					await holder.readOpenWatch({
						...attachInput("scope:a"),
						bindingIdentity: "binding:a",
					}),
				).toEqual(opened);

				expect(
					await command.openWatch({
						...openInput("scope:a", "binding:wrong-context"),
						authorityPartitionDigest: otherAuthorityPartitionDigest,
					}),
				).toEqual({ status: "unavailable" });

				const resumeToken = "opaque.resume.token";
				expect(
					await command.stageGeneration({
						...lease,
						bindingIdentity: "binding:a",
						observedInvalidationGeneration: 1n,
						generation: 1n,
						resumeToken,
						resultBytes,
						dependencyPlanBytes,
						delivery: "initial",
						resetReason: null,
					}),
				).toBe(true);
				expect((await holder.scanOpenWatches(lease))[0]?.latest).toEqual({
					generation: 1n,
					tokenDigest: sha256Digest(resumeToken),
					resultBytes,
					dependencyPlanBytes,
					delivery: "initial",
					resetReason: null,
					acknowledged: false,
				});
				const [invalidated] = await databases[1]!<{ generation: bigint }[]>`
					update questpie_internal.realtime_watch_bindings
					set invalidation_generation = invalidation_generation + 1
					where application_name = ${applicationName}
					  and scope_identity = 'scope:a'
					  and binding_identity = 'binding:a'
					returning invalidation_generation as generation
				`;
				expect(BigInt(invalidated!.generation)).toBe(2n);
				expect(
					await command.stageGeneration({
						...lease,
						bindingIdentity: "binding:a",
						observedInvalidationGeneration: 1n,
						generation: 2n,
						resumeToken: "stale.token",
						resultBytes,
						dependencyPlanBytes,
						delivery: "update",
						resetReason: null,
					}),
				).toBe(false);
				expect(
					await acknowledger.acknowledgeWatch({
						...attachInput("scope:a"),
						bindingIdentity: "binding:a",
						generation: 1n,
						resumeToken: "wrong.token",
					}),
				).toBe(false);
				expect(
					await acknowledger.acknowledgeWatch({
						...attachInput("scope:a"),
						bindingIdentity: "binding:a",
						generation: 1n,
						resumeToken,
					}),
				).toBe(true);
				expect((await holder.scanOpenWatches(lease))[0]).toMatchObject({
					invalidationGeneration: 2n,
					evaluatedInvalidationGeneration: 1n,
					latest: {
						generation: 1n,
						tokenDigest: sha256Digest(resumeToken),
						resultBytes,
						dependencyPlanBytes,
						delivery: "initial",
						resetReason: null,
						acknowledged: true,
					},
				});
				const successorToken = "opaque.successor.token";
				expect(
					await command.stageGeneration({
						...lease,
						bindingIdentity: "binding:a",
						observedInvalidationGeneration: 2n,
						generation: 2n,
						resumeToken: successorToken,
						resultBytes,
						dependencyPlanBytes,
						delivery: "update",
						resetReason: null,
					}),
				).toBe(true);
				const beforeSuccessorAcknowledgement = await databases[0]!<
					{
						generation: bigint;
						latest: boolean;
						acknowledged: boolean;
					}[]
				>`
					select generation,
					       latest_slot is not null as latest,
					       ack_slot is not null as acknowledged
					from questpie_internal.realtime_binding_generations
					where application_name = ${applicationName}
					  and scope_identity = 'scope:a'
					  and binding_identity = 'binding:a'
					order by generation
				`;
				expect(
					beforeSuccessorAcknowledgement.map((row) => ({
						...row,
						generation: BigInt(row.generation),
					})),
				).toEqual([
					{ generation: 1n, latest: false, acknowledged: true },
					{ generation: 2n, latest: true, acknowledged: false },
				]);
				expect(
					await acknowledger.acknowledgeWatch({
						...attachInput("scope:a"),
						bindingIdentity: "binding:a",
						generation: 2n,
						resumeToken: successorToken,
					}),
				).toBe(true);
				const afterSuccessorAcknowledgement = await databases[0]!<
					{
						generation: bigint;
						latest: boolean;
						acknowledged: boolean;
					}[]
				>`
					select generation,
					       latest_slot is not null as latest,
					       ack_slot is not null as acknowledged
					from questpie_internal.realtime_binding_generations
					where application_name = ${applicationName}
					  and scope_identity = 'scope:a'
					  and binding_identity = 'binding:a'
					order by generation
				`;
				expect(
					afterSuccessorAcknowledgement.map((row) => ({
						...row,
						generation: BigInt(row.generation),
					})),
				).toEqual([{ generation: 2n, latest: true, acknowledged: true }]);
				expect((await holder.scanOpenWatches(lease))[0]).toMatchObject({
					invalidationGeneration: 2n,
					evaluatedInvalidationGeneration: 2n,
					latest: {
						generation: 2n,
						tokenDigest: sha256Digest(successorToken),
						delivery: "update",
						acknowledged: true,
					},
				});
				expect(
					await command.closeWatch({
						...attachInput("scope:a"),
						bindingIdentity: "binding:a",
					}),
				).toBe(true);
				expect(await holder.scanOpenWatches(lease)).toEqual([]);
			},
		);

		postgresTest(
			"enforces 64 active slots across scopes and instances while expiry and deployments remain independent",
			async () => {
				const first = store(0);
				const second = store(1);
				await first.attachScope(attachInput("scope:first"));
				await second.attachScope(attachInput("scope:second"));
				const secondLease = {
					...attachInput("scope:second"),
					holderGeneration: 1n,
				} as const;

				const opened = await Promise.all(
					Array.from({ length: 64 }, (_, index) => {
						const store = index % 2 === 0 ? first : second;
						const scopeIdentity = index < 32 ? "scope:first" : "scope:second";
						return store.openWatch(
							openInput(scopeIdentity, `binding:${index + 1}`),
						);
					}),
				);
				expect(opened.every((result) => result.status === "opened")).toBe(true);
				expect(
					new Set(
						opened.flatMap((result) =>
							result.status === "opened" ? [result.activeSlot] : [],
						),
					).size,
				).toBe(64);
				expect(
					await second.openWatch(openInput("scope:second", "binding:limited")),
				).toEqual({ status: "limit" });
				expect(
					await first.closeWatch({
						...attachInput("scope:second"),
						bindingIdentity: "binding:64",
					}),
				).toBe(true);
				expect(
					await second.openWatch(openInput("scope:second", "binding:limited")),
				).toEqual({
					status: "opened",
					activeSlot:
						opened[63]!.status === "opened" ? opened[63]!.activeSlot : 0,
				});

				expect(
					await second.attachScope({
						...attachInput("scope:next-deployment"),
						deploymentDigest: nextDeploymentDigest,
					}),
				).toEqual({ status: "attached", holderGeneration: 1n });
				expect(
					await second.openWatch({
						...openInput("scope:next-deployment", "binding:next-deployment"),
						deploymentDigest: nextDeploymentDigest,
					}),
				).toEqual({ status: "opened", activeSlot: 1 });

				const clockFixture = await databases[0]!.reserve();
				try {
					await clockFixture.unsafe("set session_replication_role = replica");
					await clockFixture`
						update questpie_internal.realtime_scope_attachments
						set opened_at = transaction_timestamp() - interval '31 seconds',
						    renewed_at = transaction_timestamp() - interval '31 seconds',
						    expires_at = transaction_timestamp() - interval '1 second'
						where application_name = ${applicationName}
						  and scope_identity = 'scope:first'
					`;
				} finally {
					await clockFixture.unsafe("set session_replication_role = origin");
					clockFixture.release();
				}
				expect(
					await first.expireScopes({ applicationName, deploymentDigest }),
				).toEqual({ scopes: 1, watches: 32 });
				expect(
					await second.openWatch({
						...openInput("scope:second", "binding:after-expiry"),
					}),
				).toEqual({ status: "opened", activeSlot: 1 });
				expect(await first.withdrawScope(secondLease)).toBe(true);
				expect(await second.scanOpenWatches(secondLease)).toEqual([]);
				await first.attachScope(attachInput("scope:replacement"));
				expect(
					await second.openWatch(
						openInput("scope:replacement", "binding:replacement"),
					),
				).toEqual({ status: "opened", activeSlot: 1 });
			},
		);
	},
);
