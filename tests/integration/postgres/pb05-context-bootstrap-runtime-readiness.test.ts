import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { SQL } from "bun";

import { canonicalArtifactBytes, compileApplication } from "@questpie/compiler";

import {
	beta05Ids,
	beta05PostgresUrl,
	prepareBeta05PostgresApplication,
} from "./helpers/beta05-runtime";

const database = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;

afterAll(async () => {
	await database?.close({ timeout: 0 });
});

function artifactDigest(domain: string, value: unknown): string {
	return createHash("sha256")
		.update(`${domain}\0`)
		.update(canonicalArtifactBytes(value))
		.digest("hex");
}

function contentDigest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

postgresTest(
	"binds ContextBootstrap plans to the generated server before Runtime readiness",
	async () => {
		const prepared = await prepareBeta05PostgresApplication(database!);
		const generatedRoot = prepared.generated.generatedRoot;
		const temporary = dirname(dirname(generatedRoot));
		const executionPath = join(temporary, "src/execution.ts");
		const queryPath = join(temporary, "src/consumer.ts");
		const probeKey = "__questpiePb05ContextReadinessProbe";
		const probe = { context: 0, handler: 0 };
		(globalThis as Record<string, unknown>)[probeKey] = probe;
		try {
			const executionSource = await readFile(executionPath, "utf8");
			const querySource = await readFile(queryPath, "utf8");
			const contextNeedle =
				"resolve: async ({ input, principal, bootstrap }) => {";
			const handlerNeedle = "handler: async ({ input, ctx }) => {";
			expect(executionSource).toContain(contextNeedle);
			expect(querySource).toContain(handlerNeedle);
			await Promise.all([
				writeFile(
					executionPath,
					executionSource.replace(
						contextNeedle,
						`${contextNeedle}\n\t\t(globalThis as any).${probeKey}.context += 1;`,
					),
				),
				writeFile(
					queryPath,
					querySource.replace(
						handlerNeedle,
						`${handlerNeedle}\n\t\t(globalThis as any).${probeKey}.handler += 1;`,
					),
				),
			]);
			const instrumented = await compileApplication({
				applicationRoot: temporary,
			});
			const compiledRuntimeBuild = JSON.parse(
				instrumented.generatedFiles["runtime-build.json"]!,
			);
			const compiledApplicationFiles = Object.entries(
				instrumented.generatedFiles,
			).filter(
				([path]) =>
					path === "internal/application.js" ||
					(path.startsWith("internal/application-") && path.endsWith(".js")),
			);
			const digestApplicationFiles = compiledApplicationFiles.filter(
				([, bytes]) =>
					bytes.includes(
						compiledRuntimeBuild.postgresContextBootstrapPlansDigest,
					),
			);
			expect(digestApplicationFiles).toHaveLength(1);
			expect(
				digestApplicationFiles[0]![1].split(
					compiledRuntimeBuild.postgresContextBootstrapPlansDigest,
				).length - 1,
			).toBe(1);
			const collectionDigestApplicationFiles = compiledApplicationFiles.filter(
				([, bytes]) =>
					bytes.includes(
						compiledRuntimeBuild.postgresCollectionOperationPlansDigest,
					),
			);
			expect(collectionDigestApplicationFiles).toHaveLength(1);
			expect(
				collectionDigestApplicationFiles[0]![1].split(
					compiledRuntimeBuild.postgresCollectionOperationPlansDigest,
				).length - 1,
			).toBe(1);

			const internal = await prepared.generated.loadInternal();
			const createApplication = internal.createApplication as (
				input: unknown,
			) => Promise<{
				execution(
					input: unknown,
					use: (scope: {
						queries: Readonly<{
							messages: Readonly<{
								page(input: unknown): Promise<unknown>;
							}>;
						}>;
					}) => unknown,
				): Promise<unknown>;
				close(): Promise<void>;
			}>;
			const application = await createApplication({
				postgres: {
					connectionUrl: beta05PostgresUrl(),
					directConnectionUrl: beta05PostgresUrl(),
				},
				realtime: { hmacKey: new Uint8Array(32) },
				maintenance: { authorize: () => true },
			});
			try {
				await application.execution(
					{
						principal: prepared.generated.framework.principal.user({
							id: beta05Ids.principal,
						}),
						context: { companyId: beta05Ids.company },
					},
					(scope) =>
						scope.queries.messages.page({
							channelId: beta05Ids.channel,
							first: 1,
							after: null,
						}),
				);
			} finally {
				await application.close();
			}
			expect(probe).toEqual({ context: 1, handler: 1 });

			const plansPath = join(
				generatedRoot,
				"postgres-context-bootstrap-plans.json",
			);
			const mutationStatementsPath = join(
				generatedRoot,
				"postgres-mutation-transaction-statements.json",
			);
			const collectionPlansPath = join(
				generatedRoot,
				"postgres-collection-operation-plans.json",
			);
			const runtimeBuildPath = join(generatedRoot, "runtime-build.json");
			const checksumsPath = join(generatedRoot, "internal/checksums.json");
			const plansBytes = await readFile(plansPath, "utf8");
			const mutationStatementsBytes = await readFile(
				mutationStatementsPath,
				"utf8",
			);
			const collectionPlansBytes = await readFile(collectionPlansPath, "utf8");
			const runtimeBuildBytes = await readFile(runtimeBuildPath, "utf8");
			const checksumsBytes = await readFile(checksumsPath, "utf8");
			const plans = JSON.parse(plansBytes);
			const firstPlan = plans.plans[0];
			const { digest: _planDigest, ...unsignedPlan } = firstPlan;
			expect(unsignedPlan.sql).toContain("\nLIMIT 1");
			const forgedUnsignedPlan = {
				...unsignedPlan,
				sql: unsignedPlan.sql.replace("\nLIMIT 1", "\nOR TRUE\nLIMIT 1"),
			};
			const forgedPlan = {
				...forgedUnsignedPlan,
				digest: artifactDigest(
					"questpie-postgres-context-bootstrap-plan-v1",
					forgedUnsignedPlan,
				),
			};
			const { digest: _plansDigest, ...unsignedPlans } = plans;
			const forgedUnsignedPlans = {
				...unsignedPlans,
				plans: [forgedPlan, ...plans.plans.slice(1)],
			};
			const forgedPlans = {
				...forgedUnsignedPlans,
				digest: artifactDigest(
					"questpie-postgres-context-bootstrap-plans-v1",
					forgedUnsignedPlans,
				),
			};
			const forgedPlansBytes = canonicalArtifactBytes(forgedPlans);
			const runtimeBuild = JSON.parse(runtimeBuildBytes);
			const { digest: _runtimeBuildDigest, ...unsignedRuntimeBuild } =
				runtimeBuild;
			const forgedUnsignedRuntimeBuild = {
				...unsignedRuntimeBuild,
				postgresContextBootstrapPlansDigest: forgedPlans.digest,
				inventory: unsignedRuntimeBuild.inventory.map(
					(item: Readonly<{ path: string; digest: string }>) =>
						item.path === "postgres-context-bootstrap-plans.json"
							? { ...item, digest: contentDigest(forgedPlansBytes) }
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
			const forgedRuntimeBuildBytes =
				canonicalArtifactBytes(forgedRuntimeBuild);
			const checksums = JSON.parse(checksumsBytes);
			checksums.files = checksums.files.map(
				(item: Readonly<{ path: string; digest: string }>) =>
					item.path === "postgres-context-bootstrap-plans.json"
						? { ...item, digest: contentDigest(forgedPlansBytes) }
						: item.path === "runtime-build.json"
							? { ...item, digest: contentDigest(forgedRuntimeBuildBytes) }
							: item,
			);
			await Promise.all([
				writeFile(plansPath, forgedPlansBytes),
				writeFile(runtimeBuildPath, forgedRuntimeBuildBytes),
				writeFile(checksumsPath, canonicalArtifactBytes(checksums)),
			]);

			let databaseConnections = 0;
			const databaseProbe = createServer((socket) => {
				databaseConnections += 1;
				socket.destroy();
			});
			await new Promise<void>((resolve, reject) => {
				databaseProbe.once("error", reject);
				databaseProbe.listen(0, "127.0.0.1", resolve);
			});
			try {
				const address = databaseProbe.address();
				if (!address || typeof address === "string")
					throw new Error("database probe did not bind a TCP port");
				await new Promise<void>((resolve, reject) => {
					const positiveControl = connect({
						host: "127.0.0.1",
						port: address.port,
					});
					positiveControl.once("error", reject);
					positiveControl.once("close", () => resolve());
				});
				expect(databaseConnections).toBe(1);
				databaseConnections = 0;
				probe.context = 0;
				probe.handler = 0;
				await expect(
					createApplication({
						postgres: {
							connectionUrl: `postgres://127.0.0.1:${address.port}/questpie`,
							directConnectionUrl: `postgres://127.0.0.1:${address.port}/questpie`,
						},
						realtime: { hmacKey: new Uint8Array(32) },
						maintenance: { authorize: () => true },
					}),
				).rejects.toThrow(
					"generated ContextBootstrap plans do not match Runtime Build",
				);
				expect(probe).toEqual({ context: 0, handler: 0 });
				expect(databaseConnections).toBe(0);

				await Promise.all([
					writeFile(plansPath, plansBytes),
					writeFile(runtimeBuildPath, runtimeBuildBytes),
					writeFile(checksumsPath, checksumsBytes),
				]);

				const mutationStatements = JSON.parse(mutationStatementsBytes);
				const commitIndex = mutationStatements.statements.findIndex(
					(statement: Readonly<{ identity: string }>) =>
						statement.identity === "mutation.receipt.commit",
				);
				expect(commitIndex).toBeGreaterThanOrEqual(0);
				const commit = mutationStatements.statements[commitIndex];
				expect(commit.text).toContain(" AND call_id = $6");
				const {
					digest: _mutationStatementsDigest,
					...unsignedMutationStatements
				} = mutationStatements;
				const forgedUnsignedMutationStatements = {
					...unsignedMutationStatements,
					statements: mutationStatements.statements.map(
						(statement: Readonly<Record<string, unknown>>, index: number) =>
							index === commitIndex
								? {
										...statement,
										text: String(statement.text).replace(
											" AND call_id = $6",
											" OR call_id = $6",
										),
									}
								: statement,
					),
				};
				const forgedMutationStatements = {
					...forgedUnsignedMutationStatements,
					digest: artifactDigest(
						"questpie-postgres-mutation-transaction-statements-v1",
						forgedUnsignedMutationStatements,
					),
				};
				const forgedMutationStatementsBytes = canonicalArtifactBytes(
					forgedMutationStatements,
				);
				const forgedMutationUnsignedRuntimeBuild = {
					...unsignedRuntimeBuild,
					postgresMutationTransactionStatementsDigest:
						forgedMutationStatements.digest,
					inventory: unsignedRuntimeBuild.inventory.map(
						(item: Readonly<{ path: string; digest: string }>) =>
							item.path === "postgres-mutation-transaction-statements.json"
								? {
										...item,
										digest: contentDigest(forgedMutationStatementsBytes),
									}
								: item,
					),
				};
				const forgedMutationRuntimeBuild = {
					...forgedMutationUnsignedRuntimeBuild,
					digest: artifactDigest(
						"questpie-runtime-build-v1",
						forgedMutationUnsignedRuntimeBuild,
					),
				};
				const forgedMutationRuntimeBuildBytes = canonicalArtifactBytes(
					forgedMutationRuntimeBuild,
				);
				const forgedMutationChecksums = JSON.parse(checksumsBytes);
				forgedMutationChecksums.files = forgedMutationChecksums.files.map(
					(item: Readonly<{ path: string; digest: string }>) =>
						item.path === "postgres-mutation-transaction-statements.json"
							? {
									...item,
									digest: contentDigest(forgedMutationStatementsBytes),
								}
							: item.path === "runtime-build.json"
								? {
										...item,
										digest: contentDigest(forgedMutationRuntimeBuildBytes),
									}
								: item,
				);
				await Promise.all([
					writeFile(mutationStatementsPath, forgedMutationStatementsBytes),
					writeFile(runtimeBuildPath, forgedMutationRuntimeBuildBytes),
					writeFile(
						checksumsPath,
						canonicalArtifactBytes(forgedMutationChecksums),
					),
				]);
				await expect(
					createApplication({
						postgres: {
							connectionUrl: `postgres://127.0.0.1:${address.port}/questpie`,
							directConnectionUrl: `postgres://127.0.0.1:${address.port}/questpie`,
						},
						realtime: { hmacKey: new Uint8Array(32) },
						maintenance: { authorize: () => true },
					}),
				).rejects.toThrow(
					"generated Mutation transaction statements do not match Runtime Build",
				);
				expect(probe).toEqual({ context: 0, handler: 0 });
				expect(databaseConnections).toBe(0);
				await Promise.all([
					writeFile(mutationStatementsPath, mutationStatementsBytes),
					writeFile(runtimeBuildPath, runtimeBuildBytes),
					writeFile(checksumsPath, checksumsBytes),
				]);

				const collectionPlans = JSON.parse(collectionPlansBytes);
				const collectionGetIndex = collectionPlans.plans.findIndex(
					(plan: Readonly<{ member: string }>) => plan.member === "get",
				);
				expect(collectionGetIndex).toBeGreaterThanOrEqual(0);
				const collectionGet = collectionPlans.plans[collectionGetIndex];
				expect(collectionGet.read.sql).toContain(" LIMIT 1");
				const { digest: _collectionPlansDigest, ...unsignedCollectionPlans } =
					collectionPlans;
				const forgedUnsignedCollectionPlans = {
					...unsignedCollectionPlans,
					plans: collectionPlans.plans.map(
						(plan: Readonly<Record<string, unknown>>, index: number) =>
							index === collectionGetIndex
								? {
										...plan,
										read: {
											...(plan.read as Readonly<Record<string, unknown>>),
											sql: collectionGet.read.sql.replace(
												" LIMIT 1",
												" LIMIT 0",
											),
										},
									}
								: plan,
					),
				};
				const forgedCollectionPlans = {
					...forgedUnsignedCollectionPlans,
					digest: artifactDigest(
						"questpie-postgres-collection-operation-plans-v1",
						forgedUnsignedCollectionPlans,
					),
				};
				const forgedCollectionPlansBytes = canonicalArtifactBytes(
					forgedCollectionPlans,
				);
				const forgedCollectionUnsignedRuntimeBuild = {
					...unsignedRuntimeBuild,
					postgresCollectionOperationPlansDigest: forgedCollectionPlans.digest,
					inventory: unsignedRuntimeBuild.inventory.map(
						(item: Readonly<{ path: string; digest: string }>) =>
							item.path === "postgres-collection-operation-plans.json"
								? {
										...item,
										digest: contentDigest(forgedCollectionPlansBytes),
									}
								: item,
					),
				};
				const forgedCollectionRuntimeBuild = {
					...forgedCollectionUnsignedRuntimeBuild,
					digest: artifactDigest(
						"questpie-runtime-build-v1",
						forgedCollectionUnsignedRuntimeBuild,
					),
				};
				const forgedCollectionRuntimeBuildBytes = canonicalArtifactBytes(
					forgedCollectionRuntimeBuild,
				);
				const forgedCollectionChecksums = JSON.parse(checksumsBytes);
				forgedCollectionChecksums.files = forgedCollectionChecksums.files.map(
					(item: Readonly<{ path: string; digest: string }>) =>
						item.path === "postgres-collection-operation-plans.json"
							? {
									...item,
									digest: contentDigest(forgedCollectionPlansBytes),
								}
							: item.path === "runtime-build.json"
								? {
										...item,
										digest: contentDigest(forgedCollectionRuntimeBuildBytes),
									}
								: item,
				);
				await Promise.all([
					writeFile(collectionPlansPath, forgedCollectionPlansBytes),
					writeFile(runtimeBuildPath, forgedCollectionRuntimeBuildBytes),
					writeFile(
						checksumsPath,
						canonicalArtifactBytes(forgedCollectionChecksums),
					),
				]);
				try {
					await expect(
						createApplication({
							postgres: {
								connectionUrl: `postgres://127.0.0.1:${address.port}/questpie`,
								directConnectionUrl: `postgres://127.0.0.1:${address.port}/questpie`,
							},
							realtime: { hmacKey: new Uint8Array(32) },
							maintenance: { authorize: () => true },
						}),
					).rejects.toThrow(
						"generated Collection operation plans do not match Runtime Build",
					);
					expect(probe).toEqual({ context: 0, handler: 0 });
					expect(databaseConnections).toBe(0);
				} finally {
					await Promise.all([
						writeFile(collectionPlansPath, collectionPlansBytes),
						writeFile(runtimeBuildPath, runtimeBuildBytes),
						writeFile(checksumsPath, checksumsBytes),
					]);
				}

				const forgedRoot = join(
					temporary,
					".questpie/forged-context-readiness",
				);
				await rm(forgedRoot, { force: true, recursive: true });
				await cp(generatedRoot, forgedRoot, { recursive: true });
				try {
					const schemaMismatchPlanIndex = plans.plans.findIndex(
						(plan: Readonly<{ fields: readonly unknown[] }>) =>
							plan.fields.some(
								(field: unknown) => (field as { key?: unknown }).key === "role",
							),
					);
					expect(schemaMismatchPlanIndex).toBeGreaterThanOrEqual(0);
					const schemaMismatchSourcePlan = plans.plans[schemaMismatchPlanIndex];
					const roleFieldIndex = schemaMismatchSourcePlan.fields.findIndex(
						(field: Readonly<{ key: string }>) => field.key === "role",
					);
					expect(roleFieldIndex).toBeGreaterThanOrEqual(0);
					expect(
						schemaMismatchSourcePlan.fields[roleFieldIndex].codec.kind,
					).toBe("text");
					const { digest: _schemaPlanDigest, ...unsignedSchemaPlan } =
						schemaMismatchSourcePlan;
					const schemaMismatchUnsignedPlan = {
						...unsignedSchemaPlan,
						fields: unsignedSchemaPlan.fields.map(
							(field: Readonly<Record<string, unknown>>, index: number) =>
								index === roleFieldIndex
									? { ...field, codec: { kind: "uuid" } }
									: field,
						),
					};
					const schemaMismatchPlan = {
						...schemaMismatchUnsignedPlan,
						digest: artifactDigest(
							"questpie-postgres-context-bootstrap-plan-v1",
							schemaMismatchUnsignedPlan,
						),
					};
					const schemaMismatchUnsignedPlans = {
						...unsignedPlans,
						plans: plans.plans.map((plan: unknown, index: number) =>
							index === schemaMismatchPlanIndex ? schemaMismatchPlan : plan,
						),
					};
					const schemaMismatchPlans = {
						...schemaMismatchUnsignedPlans,
						digest: artifactDigest(
							"questpie-postgres-context-bootstrap-plans-v1",
							schemaMismatchUnsignedPlans,
						),
					};
					const schemaMismatchPlansBytes =
						canonicalArtifactBytes(schemaMismatchPlans);
					const [digestChunkPath, digestChunkBytes] =
						digestApplicationFiles[0]!;
					const forgedDigestChunkBytes = digestChunkBytes.replace(
						plans.digest,
						schemaMismatchPlans.digest,
					);
					expect(forgedDigestChunkBytes).not.toContain(plans.digest);
					expect(forgedDigestChunkBytes).toContain(schemaMismatchPlans.digest);
					const schemaMismatchUnsignedRuntimeBuild = {
						...unsignedRuntimeBuild,
						postgresContextBootstrapPlansDigest: schemaMismatchPlans.digest,
						serverBundleDigest:
							digestChunkPath === "internal/application.js"
								? contentDigest(forgedDigestChunkBytes)
								: unsignedRuntimeBuild.serverBundleDigest,
						inventory: unsignedRuntimeBuild.inventory.map(
							(item: Readonly<{ path: string; digest: string }>) =>
								item.path === "postgres-context-bootstrap-plans.json"
									? {
											...item,
											digest: contentDigest(schemaMismatchPlansBytes),
										}
									: item.path === digestChunkPath
										? {
												...item,
												digest: contentDigest(forgedDigestChunkBytes),
											}
										: item,
						),
					};
					const schemaMismatchRuntimeBuild = {
						...schemaMismatchUnsignedRuntimeBuild,
						digest: artifactDigest(
							"questpie-runtime-build-v1",
							schemaMismatchUnsignedRuntimeBuild,
						),
					};
					const schemaMismatchRuntimeBuildBytes = canonicalArtifactBytes(
						schemaMismatchRuntimeBuild,
					);
					const schemaMismatchChecksums = JSON.parse(checksumsBytes);
					schemaMismatchChecksums.files = schemaMismatchChecksums.files.map(
						(item: Readonly<{ path: string; digest: string }>) =>
							item.path === "postgres-context-bootstrap-plans.json"
								? {
										...item,
										digest: contentDigest(schemaMismatchPlansBytes),
									}
								: item.path === digestChunkPath
									? {
											...item,
											digest: contentDigest(forgedDigestChunkBytes),
										}
									: item.path === "runtime-build.json"
										? {
												...item,
												digest: contentDigest(schemaMismatchRuntimeBuildBytes),
											}
										: item,
					);
					await Promise.all([
						writeFile(
							join(forgedRoot, "postgres-context-bootstrap-plans.json"),
							schemaMismatchPlansBytes,
						),
						writeFile(
							join(forgedRoot, digestChunkPath),
							forgedDigestChunkBytes,
						),
						writeFile(
							join(forgedRoot, "runtime-build.json"),
							schemaMismatchRuntimeBuildBytes,
						),
						writeFile(
							join(forgedRoot, "internal/checksums.json"),
							canonicalArtifactBytes(schemaMismatchChecksums),
						),
					]);
					const forgedInternal = await import(
						`${pathToFileURL(join(forgedRoot, "internal/application.js")).href}?pb05=${crypto.randomUUID()}`
					);
					await expect(
						(forgedInternal.createApplication as typeof createApplication)({
							postgres: {
								connectionUrl: `postgres://127.0.0.1:${address.port}/questpie`,
								directConnectionUrl: `postgres://127.0.0.1:${address.port}/questpie`,
							},
							realtime: { hmacKey: new Uint8Array(32) },
							maintenance: { authorize: () => true },
						}),
					).rejects.toThrow("ContextBootstrap Field does not match Schema");
					expect(probe).toEqual({ context: 0, handler: 0 });
					expect(databaseConnections).toBe(0);
				} finally {
					await rm(forgedRoot, { force: true, recursive: true });
				}
			} finally {
				await new Promise<void>((resolve, reject) =>
					databaseProbe.close((error) => (error ? reject(error) : resolve())),
				);
			}
		} finally {
			delete (globalThis as Record<string, unknown>)[probeKey];
			await prepared.dispose();
		}
	},
	60_000,
);
