import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { SQL } from "bun";

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

function artifactDigest(domain: string, value: unknown): string {
	return createHash("sha256")
		.update(`${domain}\0${JSON.stringify(value)}\n`)
		.digest("hex");
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
			const wirePath = join(generated.generatedRoot, "wire-contract.json");
			const checksumsPath = join(
				generated.generatedRoot,
				"internal/checksums.json",
			);
			const wireBytes = await readFile(wirePath, "utf8");
			const checksumsBytes = await readFile(checksumsPath, "utf8");
			const mismatched = JSON.parse(runtimeBuildBytes);
			mismatched.schemaFingerprint = "0".repeat(64);
			await writeFile(runtimeBuildPath, `${JSON.stringify(mismatched)}\n`);
			await expect(
				generated.app.createApp({
					postgres: { url: beta05PostgresUrl() },
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
					postgres: { url: beta05PostgresUrl() },
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

			const { digest: _wireDigest, ...unsignedWire } = JSON.parse(wireBytes);
			const {
				failureDetails: _failureDetails,
				resultKinds: _resultKinds,
				callIdentity: _callIdentity,
				transactionIdentity: _transactionIdentity,
				committedResultUnavailable: _committedResultUnavailable,
				compatibility: originalCompatibility,
				...sharedWire
			} = unsignedWire;
			const forgedV1Sibling = {
				...sharedWire,
				version: 1,
				application: "application:forged",
				failures: unsignedWire.failures.filter(
					(code: string) => code !== "COMMITTED_RESULT_UNAVAILABLE",
				),
			};
			const forgedUnsignedWire = {
				...unsignedWire,
				application: "application:forged",
				compatibility: {
					...originalCompatibility,
					wireV1Digest: artifactDigest(
						"questpie-operation-wire-v1",
						forgedV1Sibling,
					),
				},
			};
			const forgedWire = {
				...forgedUnsignedWire,
				digest: artifactDigest(
					"questpie-operation-wire-v2",
					forgedUnsignedWire,
				),
			};
			const forgedWireBytes = `${JSON.stringify(forgedWire)}\n`;
			const { digest: _runtimeBuildDigest, ...unsignedRuntimeBuild } =
				JSON.parse(runtimeBuildBytes);
			const forgedUnsignedRuntimeBuild = {
				...unsignedRuntimeBuild,
				application: "application:forged",
				wireDigest: forgedWire.digest,
				inventory: unsignedRuntimeBuild.inventory.map(
					(item: Readonly<{ path: string; digest: string }>) =>
						item.path === "wire-contract.json"
							? { ...item, digest: contentDigest(forgedWireBytes) }
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
					item.path === "wire-contract.json"
						? { ...item, digest: contentDigest(forgedWireBytes) }
						: item.path === "runtime-build.json"
							? { ...item, digest: contentDigest(forgedRuntimeBuildBytes) }
							: item,
			);
			await Promise.all([
				writeFile(wirePath, forgedWireBytes),
				writeFile(runtimeBuildPath, forgedRuntimeBuildBytes),
				writeFile(checksumsPath, `${JSON.stringify(checksums)}\n`),
			]);
			const forgedOutcome = await generated.app
				.createApp({
					postgres: { url: beta05PostgresUrl() },
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
				writeFile(wirePath, wireBytes),
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
								url: "postgres://unreachable:unreachable@127.0.0.1:1/postgres",
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
				{ ...originalQueryPlans, plans: [] },
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
				postgres: { url: beta05PostgresUrl() },
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
						queries: Readonly<
							Record<string, (queryInput: unknown) => Promise<unknown>>
						>;
					}>) => {
						expect(tenant.id).toBe(beta05Ids.company);
						expect(services["audit.connection"].id).toBe(1);
						expect(services["audit.execution"].connectionId).toBe(1);
						return queries["messages.page"]!(input);
					},
				);
				const runtimeBuild = JSON.parse(runtimeBuildBytes);
				const wire = JSON.parse(
					await readFile(
						join(generated.generatedRoot, "wire-contract.json"),
						"utf8",
					),
				);
				const rawRequest = new Request(
					"http://runtime.test/_questpie/operation",
					{
						method: "POST",
						headers: { "content-type": wire.mediaType },
						body: JSON.stringify({
							application: runtimeBuild.application,
							callId: crypto.randomUUID(),
							clientContractDigest: runtimeBuild.clientContractDigest,
							context,
							input,
							operation: "query:messages.page",
							protocol: wire.protocol,
							timeoutMilliseconds: 5_000,
							wireDigest: runtimeBuild.wireDigest,
						}),
					},
				);
				const rawResponse = await application.fetch(
					internal.bindIngressPrincipalForRequest(rawRequest, user),
				);
				expect(rawResponse.status).toBe(200);
				const rawFrame = (await rawResponse.json()) as Readonly<{
					kind: string;
					payload: unknown;
				}>;
				expect(rawFrame.kind).toBe("result");

				let clientFetches = 0;
				const client = generated.client.createClient({
					baseUrl: "http://runtime.test",
					fetch: (request: Request) => {
						clientFetches += 1;
						return application.fetch(
							internal.bindIngressPrincipalForRequest(request, user),
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
				expect(rawFrame.payload).toEqual({
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
					postgres: { url: beta05PostgresUrl() },
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
