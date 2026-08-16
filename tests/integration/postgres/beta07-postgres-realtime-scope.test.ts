import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { SQL } from "bun";
import { principal } from "questpie";

import { backendPid } from "../../../packages/compiler/src/postgres-session";
import { ensureInternalProtocolV3 } from "../../../packages/compiler/src/schema";
import { sha256Digest } from "../../../packages/runtime/src/canonical-json";
import { createPostgresRealtimeScopeStore } from "../../../packages/runtime/src/live-query/postgres-realtime-scope";

const databases = process.env.PGHOST
	? [new SQL({ max: 1 }), new SQL({ max: 1 }), new SQL({ max: 1 })]
	: [];
const postgresTest = process.env.PGHOST ? test : test.skip;
const control = { lockTimeoutMs: 1_000, statementTimeoutMs: 10_000 } as const;
const applicationName = "collaboration";
const deploymentDigest = "a".repeat(64);
const nextDeploymentDigest = "b".repeat(64);
const authorityPartitionDigest = "c".repeat(64);
const otherAuthorityPartitionDigest = "d".repeat(64);
const user = principal.user({ id: "user:ada" });
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

beforeEach(async () => {
	await databases[0]?.unsafe("DROP SCHEMA IF EXISTS questpie_internal CASCADE");
	if (databases[0]) await ensure(databases[0]);
});

afterAll(async () => {
	await databases[0]?.unsafe("DROP SCHEMA IF EXISTS questpie_internal CASCADE");
	await Promise.all(
		databases.map((database) => database.close({ timeout: 0 })),
	);
});

describe.skipIf(databases.length === 0)(
	"BETA-07 PostgreSQL realtime scope authority",
	() => {
		postgresTest(
			"routes attach, open, scan, acknowledgement, and close across instances without reconstructing a Principal",
			async () => {
				const holder = createPostgresRealtimeScopeStore({ sql: databases[0]! });
				const command = createPostgresRealtimeScopeStore({
					sql: databases[1]!,
				});
				const acknowledger = createPostgresRealtimeScopeStore({
					sql: databases[2]!,
				});
				expect(await holder.attachScope(attachInput("scope:a"))).toEqual({
					status: "attached",
				});
				expect(await holder.scanOpenWatches(attachInput("scope:a"))).toEqual(
					[],
				);

				expect(
					await command.openWatch(openInput("scope:a", "binding:a")),
				).toEqual({
					status: "opened",
					activeSlot: 1,
				});
				const [opened] = await holder.scanOpenWatches(attachInput("scope:a"));
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
					await command.openWatch({
						...openInput("scope:a", "binding:wrong-context"),
						authorityPartitionDigest: otherAuthorityPartitionDigest,
					}),
				).toEqual({ status: "unavailable" });

				const resumeToken = "opaque.resume.token";
				expect(
					await command.stageGeneration({
						...attachInput("scope:a"),
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
				expect(
					(await holder.scanOpenWatches(attachInput("scope:a")))[0]?.latest,
				).toEqual({
					generation: 1n,
					tokenDigest: sha256Digest(resumeToken),
					resultBytes,
					dependencyPlanBytes,
					delivery: "initial",
					resetReason: null,
					acknowledged: false,
				});
				expect(
					await command.invalidateWatch({
						...attachInput("scope:a"),
						bindingIdentity: "binding:a",
					}),
				).toBe(2n);
				expect(
					await command.stageGeneration({
						...attachInput("scope:a"),
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
				expect(
					(await holder.scanOpenWatches(attachInput("scope:a")))[0],
				).toMatchObject({
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
				expect(
					await command.closeWatch({
						...attachInput("scope:a"),
						bindingIdentity: "binding:a",
					}),
				).toBe(true);
				expect(await holder.scanOpenWatches(attachInput("scope:a"))).toEqual(
					[],
				);
			},
		);

		postgresTest(
			"enforces 64 active slots across scopes and instances while expiry and deployments remain independent",
			async () => {
				const first = createPostgresRealtimeScopeStore({ sql: databases[0]! });
				const second = createPostgresRealtimeScopeStore({ sql: databases[1]! });
				await first.attachScope(attachInput("scope:first"));
				await second.attachScope(attachInput("scope:second"));

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
				).toEqual({ status: "attached" });
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
				expect(await first.withdrawScope(attachInput("scope:second"))).toBe(
					true,
				);
				expect(
					await second.scanOpenWatches(attachInput("scope:second")),
				).toEqual([]);
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
