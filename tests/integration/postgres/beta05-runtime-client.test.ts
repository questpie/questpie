import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { SQL } from "bun";

import { runtimeArtifactDigest as artifactDigest } from "../../../packages/runtime/src/application/artifact-protocol";
import {
	beta05Ids,
	beta05PostgresUrl,
	prepareBeta05PostgresApplication,
} from "./helpers/beta05-runtime";

const database = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;

afterAll(async () => {
	await database?.close({ timeout: 0 });
});

const postgresTest = process.env.PGHOST ? test : test.skip;

function contentDigest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

postgresTest(
	"runs the exact Message Query through direct, Fetch, and generated client paths",
	async () => {
		const prepared = await prepareBeta05PostgresApplication(database!);
		try {
			const { generated, runtimeBuildBytes } = prepared;
			const runtimeBuildPath = join(
				generated.generatedRoot,
				"runtime-build.json",
			);
			const httpPath = join(
				generated.generatedRoot,
				"operation-http-contract.json",
			);
			const mcpPath = join(generated.generatedRoot, "mcp-projection.json");
			const checksumsPath = join(
				generated.generatedRoot,
				"internal/checksums.json",
			);
			const httpBytes = await readFile(httpPath, "utf8");
			const mcpBytes = await readFile(mcpPath, "utf8");
			const checksumsBytes = await readFile(checksumsPath, "utf8");
			const mismatched = JSON.parse(runtimeBuildBytes);
			mismatched.schemaFingerprint = "0".repeat(64);
			await writeFile(runtimeBuildPath, `${JSON.stringify(mismatched)}\n`);
			await expect(
				generated.app.createApp({
					postgres: {
						connectionUrl: beta05PostgresUrl(),
						directConnectionUrl: beta05PostgresUrl(),
					},
					realtime: { hmacKey: new Uint8Array(32) },
					maintenance: { authorize: () => true },
				}),
			).rejects.toThrow("Runtime Build digest does not match");
			await writeFile(runtimeBuildPath, runtimeBuildBytes);

			const { digest: _fingerprintBuildDigest, ...unsignedFingerprintBuild } =
				JSON.parse(runtimeBuildBytes);
			const mismatchedFingerprintUnsignedBuild = {
				...unsignedFingerprintBuild,
				schemaFingerprint: "0".repeat(64),
			};
			const mismatchedFingerprintBuild = {
				...mismatchedFingerprintUnsignedBuild,
				digest: artifactDigest(
					"questpie-runtime-build-v1",
					mismatchedFingerprintUnsignedBuild,
				),
			};
			const mismatchedFingerprintBytes = `${JSON.stringify(mismatchedFingerprintBuild)}\n`;
			const fingerprintChecksums = JSON.parse(checksumsBytes);
			fingerprintChecksums.files = fingerprintChecksums.files.map(
				(item: Readonly<{ path: string; digest: string }>) =>
					item.path === "runtime-build.json"
						? { ...item, digest: contentDigest(mismatchedFingerprintBytes) }
						: item,
			);
			await Promise.all([
				writeFile(runtimeBuildPath, mismatchedFingerprintBytes),
				writeFile(checksumsPath, `${JSON.stringify(fingerprintChecksums)}\n`),
			]);
			await expect(
				generated.app.createApp({
					postgres: {
						connectionUrl: beta05PostgresUrl(),
						directConnectionUrl: beta05PostgresUrl(),
					},
					realtime: { hmacKey: new Uint8Array(32) },
					maintenance: { authorize: () => true },
				}),
			).rejects.toThrow(
				"PostgreSQL Schema Fingerprint does not match Runtime Build",
			);
			await Promise.all([
				writeFile(runtimeBuildPath, runtimeBuildBytes),
				writeFile(checksumsPath, checksumsBytes),
			]);

			const { digest: _httpDigest, ...unsignedHttp } = JSON.parse(httpBytes);
			const forgedUnsignedHttp = {
				...unsignedHttp,
				application: "application:forged",
			};
			const forgedHttp = {
				...forgedUnsignedHttp,
				digest: artifactDigest(
					"questpie-operation-http-v1",
					forgedUnsignedHttp,
				),
			};
			const forgedHttpBytes = `${JSON.stringify(forgedHttp)}\n`;
			const { digest: _mcpDigest, ...unsignedMcp } = JSON.parse(mcpBytes);
			const forgedUnsignedMcp = {
				...unsignedMcp,
				operationHttpContractDigest: forgedHttp.digest,
			};
			const forgedMcp = {
				...forgedUnsignedMcp,
				digest: artifactDigest("questpie-mcp-projection-v1", forgedUnsignedMcp),
			};
			const forgedMcpBytes = `${JSON.stringify(forgedMcp)}\n`;
			const { digest: _runtimeBuildDigest, ...unsignedRuntimeBuild } =
				JSON.parse(runtimeBuildBytes);
			const forgedUnsignedRuntimeBuild = {
				...unsignedRuntimeBuild,
				application: "application:forged",
				operationHttpContractDigest: forgedHttp.digest,
				mcpProjectionDigest: forgedMcp.digest,
				inventory: unsignedRuntimeBuild.inventory.map(
					(item: Readonly<{ path: string; digest: string }>) =>
						item.path === "operation-http-contract.json"
							? { ...item, digest: contentDigest(forgedHttpBytes) }
							: item.path === "mcp-projection.json"
								? { ...item, digest: contentDigest(forgedMcpBytes) }
								: item,
				),
			};
			const forgedRuntimeBuild = {
				...forgedUnsignedRuntimeBuild,
				digest: artifactDigest(
					"questpie-runtime-build-v1",
					forgedUnsignedRuntimeBuild,
				),
			};
			const forgedRuntimeBuildBytes = `${JSON.stringify(forgedRuntimeBuild)}\n`;
			const checksums = JSON.parse(checksumsBytes);
			checksums.files = checksums.files.map(
				(item: Readonly<{ path: string; digest: string }>) =>
					item.path === "operation-http-contract.json"
						? { ...item, digest: contentDigest(forgedHttpBytes) }
						: item.path === "mcp-projection.json"
							? { ...item, digest: contentDigest(forgedMcpBytes) }
							: item.path === "runtime-build.json"
								? { ...item, digest: contentDigest(forgedRuntimeBuildBytes) }
								: item,
			);
			await Promise.all([
				writeFile(httpPath, forgedHttpBytes),
				writeFile(mcpPath, forgedMcpBytes),
				writeFile(runtimeBuildPath, forgedRuntimeBuildBytes),
				writeFile(checksumsPath, `${JSON.stringify(checksums)}\n`),
			]);
			const forgedOutcome = await generated.app
				.createApp({
					postgres: {
						connectionUrl: beta05PostgresUrl(),
						directConnectionUrl: beta05PostgresUrl(),
					},
					realtime: { hmacKey: new Uint8Array(32) },
					maintenance: { authorize: () => true },
				})
				.then(
					async (forgedApplication: Readonly<{ close(): Promise<void> }>) => {
						await forgedApplication.close();
						return "accepted" as const;
					},
					(error: unknown) => error,
				);
			expect(forgedOutcome).toBeInstanceOf(TypeError);
			expect((forgedOutcome as Error).message).toBe(
				"Runtime executable Application Identity does not match",
			);
			await Promise.all([
				writeFile(httpPath, httpBytes),
				writeFile(mcpPath, mcpBytes),
				writeFile(runtimeBuildPath, runtimeBuildBytes),
				writeFile(checksumsPath, checksumsBytes),
			]);

			const queryPlansPath = join(
				generated.generatedRoot,
				"postgres-query-plans.json",
			);
			const queryPlansBytes = await readFile(queryPlansPath, "utf8");
			const {
				digest: _queryPlanRuntimeBuildDigest,
				...unsignedQueryPlanRuntimeBuild
			} = JSON.parse(runtimeBuildBytes);
			const refuseSelfConsistentQueryPlans = async (
				queryPlans: unknown,
				message: string,
			): Promise<void> => {
				const forgedQueryPlansBytes = JSON.stringify(queryPlans) + "\n";
				const forgedUnsignedBuild = {
					...unsignedQueryPlanRuntimeBuild,
					postgresQueryPlansDigest: contentDigest(forgedQueryPlansBytes),
					inventory: unsignedQueryPlanRuntimeBuild.inventory.map(
						(item: Readonly<{ path: string; digest: string }>) =>
							item.path === "postgres-query-plans.json"
								? { ...item, digest: contentDigest(forgedQueryPlansBytes) }
								: item,
					),
				};
				const forgedBuild = {
					...forgedUnsignedBuild,
					digest: artifactDigest(
						"questpie-runtime-build-v1",
						forgedUnsignedBuild,
					),
				};
				const forgedBuildBytes = JSON.stringify(forgedBuild) + "\n";
				const forgedChecksums = JSON.parse(checksumsBytes);
				forgedChecksums.files = forgedChecksums.files.map(
					(item: Readonly<{ path: string; digest: string }>) =>
						item.path === "postgres-query-plans.json"
							? { ...item, digest: contentDigest(forgedQueryPlansBytes) }
							: item.path === "runtime-build.json"
								? { ...item, digest: contentDigest(forgedBuildBytes) }
								: item,
				);
				await Promise.all([
					writeFile(queryPlansPath, forgedQueryPlansBytes),
					writeFile(runtimeBuildPath, forgedBuildBytes),
					writeFile(checksumsPath, JSON.stringify(forgedChecksums) + "\n"),
				]);
				try {
					await expect(
						generated.app.createApp({
							postgres: {
								connectionUrl:
									"postgres://unreachable:unreachable@127.0.0.1:1/postgres",
								directConnectionUrl:
									"postgres://unreachable:unreachable@127.0.0.1:1/postgres",
							},
							realtime: { hmacKey: new Uint8Array(32) },
							maintenance: { authorize: () => true },
						}),
					).rejects.toThrow(message);
				} finally {
					await Promise.all([
						writeFile(queryPlansPath, queryPlansBytes),
						writeFile(runtimeBuildPath, runtimeBuildBytes),
						writeFile(checksumsPath, checksumsBytes),
					]);
				}
			};
			const originalQueryPlans = JSON.parse(queryPlansBytes);
			const castTamper = structuredClone(originalQueryPlans);
			castTamper.plans[0].sql = castTamper.plans[0].sql.replaceAll(
				"$1::uuid",
				"$1::text",
			);
			await refuseSelfConsistentQueryPlans(
				castTamper,
				"Query SQL placeholders do not match its parameters",
			);
			await refuseSelfConsistentQueryPlans(
				{ ...originalQueryPlans, version: 1, plans: [] },
				"PostgreSQL Query plans do not match the Runtime Query identities",
			);
			const surplusPlan = {
				...structuredClone(originalQueryPlans.plans[0]),
				queryDigest: "f".repeat(64),
				templateDigest: "f".repeat(64),
			};
			await refuseSelfConsistentQueryPlans(
				{
					...originalQueryPlans,
					plans: [...originalQueryPlans.plans, surplusPlan],
				},
				"PostgreSQL Query plans do not match the Runtime Query identities",
			);

			const application = await generated.app.createApp({
				postgres: {
					connectionUrl: beta05PostgresUrl(),
					directConnectionUrl: beta05PostgresUrl(),
				},
				realtime: { hmacKey: new Uint8Array(32) },
				maintenance: { authorize: () => true },
			});
			try {
				const internal = await generated.loadInternal();
				const user = generated.framework.principal.user({
					id: beta05Ids.principal,
				});
				const context = { companyId: beta05Ids.company };
				const input = { channelId: beta05Ids.channel, first: 20, after: null };
				const direct = await application.execution(
					{ principal: user, context },
					async ({
						queries,
						services,
						tenant,
					}: Readonly<{
						tenant: Readonly<{ id: string }>;
						services: Readonly<{
							"audit.connection": Readonly<{ id: number }>;
							"audit.execution": Readonly<{ connectionId: number }>;
						}>;
						queries: Readonly<{
							messages: Readonly<{
								page(queryInput: unknown): Promise<unknown>;
							}>;
						}>;
					}>) => {
						expect(tenant.id).toBe(beta05Ids.company);
						expect(services["audit.connection"].id).toBe(1);
						expect(services["audit.execution"].connectionId).toBe(1);
						return queries.messages.page(input);
					},
				);
				const runtimeBuild = JSON.parse(runtimeBuildBytes);
				const callId = crypto.randomUUID();
				const rawRequest = new Request(
					`http://runtime.test/_questpie/query/messages.page?after=~null&channelId=${encodeURIComponent(input.channelId)}&first=${input.first}`,
					{
						headers: {
							cookie:
								"questpie_tracer_session=f18f8b8e0e1446079dc6e6d4755505f9",
							"Questpie-Application": runtimeBuild.application,
							"Questpie-Call-Id": encodeURIComponent(callId),
							"Questpie-Client-Contract": runtimeBuild.clientContractDigest,
							"Questpie-Context": Buffer.from(JSON.stringify(context)).toString(
								"base64url",
							),
							"Questpie-Timeout-Milliseconds": "5000",
							"Questpie-Wire-Digest": runtimeBuild.operationHttpContractDigest,
						},
					},
				);
				const rawResponse = await application.fetch(
					internal.bindIngressPrincipalForRequest(rawRequest, user),
				);
				expect(rawResponse.status, await rawResponse.clone().text()).toBe(200);
				const rawFrame = (await rawResponse.json()) as Readonly<{
					callId: string;
					result: unknown;
				}>;
				expect(rawFrame.callId).toBe(callId);

				let clientFetches = 0;
				const client = generated.client.createClient({
					baseUrl: "http://runtime.test",
					fetch: (request: Request) => {
						clientFetches += 1;
						const headers = new Headers(request.headers);
						headers.set(
							"cookie",
							"questpie_tracer_session=f18f8b8e0e1446079dc6e6d4755505f9",
						);
						return application.fetch(
							internal.bindIngressPrincipalForRequest(
								new Request(request, { headers }),
								user,
							),
						);
					},
				});
				const clientResult = await client
					.withContext(context)
					.queries["messages.page"](input);
				expect(clientFetches).toBe(1);
				expect(clientResult).toEqual(direct);
				expect(direct).toEqual({
					nodes: [
						{
							author: null,
							body: "one engine",
							createdAt: new Date("2026-08-15T10:00:00.000Z"),
							id: beta05Ids.message,
						},
					],
					pageInfo: {
						endCursor: expect.any(String),
						hasNextPage: false,
					},
				});
				expect(rawFrame.result).toEqual({
					...(direct as Readonly<Record<string, unknown>>),
					nodes: [
						{
							author: null,
							body: "one engine",
							createdAt: "2026-08-15T10:00:00.000Z",
							id: beta05Ids.message,
						},
					],
				});
			} finally {
				await application.close();
			}

			await database!`
				delete from questpie_internal.schema_migration_receipts
				where sequence = 2
			`;
			await expect(
				generated.app.createApp({
					postgres: {
						connectionUrl: beta05PostgresUrl(),
						directConnectionUrl: beta05PostgresUrl(),
					},
					realtime: { hmacKey: new Uint8Array(32) },
					maintenance: { authorize: () => true },
				}),
			).rejects.toThrow(
				"PostgreSQL migration history does not match Runtime Build",
			);
		} finally {
			await prepared.dispose();
		}
	},
);
