import { afterAll, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { SQL } from "bun";
import type { Principal } from "questpie";

import {
	applyCommittedMigrations,
	compileApplication,
	createCommittedMigration,
	createMigrationPlan,
	type CommittedMigration,
	type SchemaProjectionV1,
} from "@questpie/compiler";

import { installQuestpieForTracer } from "../../support/beta12-packed-questpie";

const admin = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;
const decoder = new TextDecoder();

afterAll(async () => {
	await admin?.close({ timeout: 0 });
});

type WorkerTrace = Readonly<{
	claimed: number;
	refusedIncompatible: number;
	outcomes: readonly Readonly<{
		runId: string;
		outcome: string;
	}>[];
}>;

type GeneratedApplication = Readonly<{
	execution<Result>(
		input: Readonly<{
			principal: Principal;
			context: Readonly<{ tenantId: string }>;
		}>,
		use: (
			scope: Readonly<{
				jobs: Readonly<{
					pin: Readonly<{
						worker: Readonly<{
							accept(
								input: Readonly<Record<never, never>>,
								options: Readonly<{
									idempotencyKey: string;
									notBefore: Date;
								}>,
							): Promise<Readonly<{ runId: string }>>;
						}>;
					}>;
				}>;
				mutations: Readonly<{
					pin: Readonly<{
						accept(
							input: Readonly<{ key: string; notBefore: Date }>,
							options: Readonly<{ callId: string }>,
						): Promise<Readonly<{ runId: string }>>;
					}>;
				}>;
			}>,
		) => Result | Promise<Result>,
	): Promise<Awaited<Result>>;
	durable: Readonly<{
		poll(
			options?: Readonly<{ claimBatch?: number; workerId?: string }>,
		): Promise<WorkerTrace>;
		inspect(runId: string): Promise<Readonly<{
			attemptCount: number;
			resultBytes: Uint8Array | null;
			state: string;
		}> | null>;
	}>;
	close(): Promise<void>;
}>;

type GeneratedInternal = Readonly<{
	createApplication(
		input: Readonly<{
			postgres: Readonly<{
				connectionUrl: string;
				directConnectionUrl: string;
			}>;
			realtime: Readonly<{ hmacKey: Uint8Array }>;
			maintenance: Readonly<{ authorize(): boolean }>;
		}>,
	): Promise<GeneratedApplication>;
}>;

function postgresUrl(databaseName?: string): string {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${databaseName ?? process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.toString();
}

function applicationConfiguration(name: string, schema: string): string {
	return `${JSON.stringify({
		$schema: "https://questpie.dev/schema/application-v1.json",
		version: 1,
		application: { name },
		postgres: {
			schema,
			minimumMajor: 16,
			databaseCollation: "C.UTF-8",
			databaseCType: "C.UTF-8",
			extensions: [],
			physicalNames: {},
		},
		source: { root: "src", exclude: [] },
		packages: {},
	})}\n`;
}

const contextSource = `import { codec, context, defineContext } from "questpie";

export const applicationContext = defineContext({
	name: "app.context",
	input: codec.object({ tenantId: codec.text() }),
	resolve: ({ input, principal }) => {
		if (principal.kind === "anonymous") throw context.error.unauthenticated();
		return { tenant: context.tenant({ id: input.tenantId }), values: {} };
	},
});
`;

function jobSource(marker: "A" | "B"): string {
	return `import { codec, durable } from "questpie";
import { defineJob } from "#questpie/app";

export const worker = defineJob({
	name: "pin.worker",
	input: codec.object({}),
	output: codec.object({ marker: codec.text() }),
	runAs: durable.caller({ whenDenied: "fail" }),
	retry: durable.retry({
		maximumAttempts: 1,
		initialDelay: "1s",
		backoff: "exponential",
		maximumDelay: "1s",
		jitter: "full",
		horizon: "1s",
	}),
	handler: () => ({ marker: ${JSON.stringify(marker)} }),
});
`;
}

async function writeMigration(
	root: string,
	migration: CommittedMigration,
): Promise<void> {
	const directory = join(root, "questpie/migrations", migration.identity);
	await mkdir(directory, { recursive: true });
	await Promise.all(
		Object.entries(migration.files).map(([name, bytes]) =>
			writeFile(join(directory, name), bytes),
		),
	);
}

async function writeApplication(
	root: string,
	input: Readonly<{
		name: string;
		schema: string;
		marker: "A" | "B";
		migration?: CommittedMigration;
	}>,
): Promise<void> {
	await mkdir(join(root, "src"), { recursive: true });
	await mkdir(join(root, "packages"), { recursive: true });
	await Promise.all([
		writeFile(
			join(root, "bun.lock"),
			await readFile(resolve(import.meta.dir, "../../../bun.lock")),
		),
		writeFile(
			join(root, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					allowImportingTsExtensions: true,
					module: "ESNext",
					moduleResolution: "Bundler",
					noEmit: true,
					noUncheckedIndexedAccess: true,
					skipLibCheck: true,
					strict: true,
					target: "ES2024",
					types: ["bun"],
					paths: { "#questpie/app": ["./.questpie/generated/app.ts"] },
				},
				include: ["src/**/*.ts"],
			}),
		),
		writeFile(
			join(root, "package.json"),
			`${JSON.stringify({
				name: "executable-pin-tracer",
				private: true,
				type: "module",
				imports: { "#questpie/app": "./.questpie/generated/app.ts" },
				dependencies: { questpie: "workspace:*" },
			})}\n`,
		),
		writeFile(
			join(root, "questpie.json"),
			applicationConfiguration(input.name, input.schema),
		),
		writeFile(join(root, "src/context.ts"), contextSource),
		writeFile(
			join(root, "src/records.ts"),
			`import { constraint, defineCollection, field } from "questpie";
export const records = defineCollection({
	name: "records",
	fields: { id: field.uuid({ nullable: false }) },
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});
`,
		),
		writeFile(join(root, "src/job.ts"), jobSource(input.marker)),
		writeFile(
			join(root, "src/reaction.ts"),
			jobSource(input.marker)
				.replaceAll("defineJob", "defineReaction")
				.replace('name: "pin.worker"', 'name: "pinReaction"')
				.replace(
					"runAs: durable.caller",
					"effects: [],\n\trunAs: durable.caller",
				),
		),
		writeFile(
			join(root, "src/accept.ts"),
			`import { codec, policy } from "questpie";
import { defineMutation } from "#questpie/app";
export const accept = defineMutation({
	name: "pin.accept",
	input: codec.object({ key: codec.text(), notBefore: codec.timestamp() }),
	output: codec.object({ runId: codec.uuid() }),
	policy: policy.authenticated(),
	errors: {},
	handler: async ({ input, ctx }) => {
		await ctx.dispatch.pinReaction({});
		const receipt = await ctx.jobs.pin.worker.accept({}, {
			idempotencyKey: input.key, notBefore: input.notBefore,
		});
		return { runId: receipt.runId };
	},
});
`,
		),
	]);
	await installQuestpieForTracer(root);
	if (!process.env.QUESTPIE_PACKED_TARBALL) {
		for (const dependency of ["typescript", "@types", "pg"])
			await symlink(
				resolve(import.meta.dir, "../../../node_modules", dependency),
				join(root, "node_modules", dependency),
				"dir",
			);
	}
	if (input.migration) await writeMigration(root, input.migration);
}

async function importBuild(root: string): Promise<
	Readonly<{
		internal: GeneratedInternal;
		principal: Principal;
		runtimeBuildDigest: string;
		jobContractDigest: string;
		reactionContractDigest: string;
	}>
> {
	const generatedRoot = join(root, ".questpie/generated");
	const nonce = `?pin=${crypto.randomUUID()}`;
	const internal = (await import(
		`${pathToFileURL(join(generatedRoot, "internal/application.js")).href}${nonce}`
	)) as GeneratedInternal;
	const framework = (await import(
		`${pathToFileURL(join(root, "node_modules/questpie/index.ts")).href}${nonce}`
	)) as Readonly<{
		principal: Readonly<{
			user(input: Readonly<{ id: string }>): Principal;
		}>;
	}>;
	const runtimeBuild = JSON.parse(
		await readFile(join(generatedRoot, "runtime-build.json"), "utf8"),
	) as Readonly<{ digest: string }>;
	const projection = JSON.parse(
		await readFile(join(generatedRoot, "job-projection.json"), "utf8"),
	) as Readonly<{
		jobs: readonly Readonly<{ contractDigest: string }>[];
	}>;
	const reactionProjection = JSON.parse(
		await readFile(join(generatedRoot, "reaction-projection.json"), "utf8"),
	) as Readonly<{ reactions: readonly Readonly<{ contractDigest: string }>[] }>;
	return Object.freeze({
		internal,
		principal: framework.principal.user({ id: "pin-worker-user" }),
		runtimeBuildDigest: runtimeBuild.digest,
		jobContractDigest: projection.jobs[0]!.contractDigest,
		reactionContractDigest: reactionProjection.reactions[0]!.contractDigest,
	});
}

function marker(
	view: Awaited<ReturnType<GeneratedApplication["durable"]["inspect"]>>,
): string | null {
	if (!view?.resultBytes) return null;
	const value = (
		JSON.parse(decoder.decode(view.resultBytes)) as {
			marker?: unknown;
		}
	).marker;
	return typeof value === "string" ? value : null;
}

postgresTest(
	"a changed handler build cannot execute a run accepted by retained build bytes",
	async () => {
		const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
		const name = `durablePin${suffix}`;
		const schema = `durable_pin_${suffix}`;
		const applicationIdentity = `application:${name}`;
		const databaseName = `qp_pin_${suffix}`;
		const connectionUrl = postgresUrl(databaseName);
		let database: SQL | undefined;
		const temporaryRoot = await mkdtemp(join(tmpdir(), "questpie-pin-"));
		const rootA = join(temporaryRoot, "a");
		const rootB = join(temporaryRoot, "b");
		const applications = new Set<GeneratedApplication>();
		const failures: unknown[] = [];
		const previousDatabaseName = process.env.PGDATABASE;
		let ownsDatabase = false;
		try {
			await admin!.unsafe(`CREATE DATABASE "${databaseName}"`);
			ownsDatabase = true;
			// Bun SQL's environment database selection must agree with the URL.
			process.env.PGDATABASE = databaseName;
			database = new SQL(connectionUrl, { max: 4 });
			const [connected] = await database`SELECT current_database() AS name`;
			expect(connected.name).toBe(databaseName);
			const [version] = await database`SHOW server_version_num`;
			expect(Number(version.server_version_num)).toBeGreaterThanOrEqual(170000);
			expect(Number(version.server_version_num)).toBeLessThan(180000);
			await writeApplication(rootA, { name, schema, marker: "A" });
			const initial = await compileApplication({ applicationRoot: rootA });
			const targetSchema = JSON.parse(
				initial.generatedFiles["schema-projection.json"]!,
			) as SchemaProjectionV1;
			const planned = createMigrationPlan({
				targetSchema,
				slug: "create-durable-pin",
			});
			const migration = createCommittedMigration({
				plan: planned.plan,
				baseSchema: planned.baseSchema,
				targetSchema,
				planDigest: planned.digest,
				localMigrations: [],
				currentSchema: targetSchema,
			});
			await writeMigration(rootA, migration);
			await writeApplication(rootB, { name, schema, marker: "B", migration });
			await compileApplication({ applicationRoot: rootA });
			await compileApplication({ applicationRoot: rootB });

			const applied = await applyCommittedMigrations({
				connectionString: connectionUrl,
				migrations: [migration],
			});
			expect(applied).toMatchObject({ status: "applied" });
			const [installed] = await database`SELECT current_database() AS name,
				to_regclass('questpie_internal.protocol')::text AS protocol`;
			expect(installed).toMatchObject({
				name: databaseName,
				protocol: "questpie_internal.protocol",
			});

			const [buildA, buildB] = await Promise.all([
				importBuild(rootA),
				importBuild(rootB),
			]);
			expect(buildA.jobContractDigest).toBe(buildB.jobContractDigest);
			expect(buildA.reactionContractDigest).toBe(buildB.reactionContractDigest);
			expect(buildA.runtimeBuildDigest).not.toBe(buildB.runtimeBuildDigest);

			const create = async (build: typeof buildA) => {
				const application = await build.internal.createApplication({
					postgres: {
						connectionUrl,
						directConnectionUrl: connectionUrl,
					},
					realtime: { hmacKey: new Uint8Array(32).fill(43) },
					maintenance: { authorize: () => false },
				});
				applications.add(application);
				return application;
			};
			const appA = await create(buildA);
			const appB = await create(buildB);
			const dueAt = new Date(Date.now() + 250);
			const acceptA = (key: string) =>
				appA.execution(
					{
						principal: buildA.principal,
						context: { tenantId: `tenant-${suffix}` },
					},
					({ jobs }) =>
						jobs.pin.worker.accept(
							{},
							{ idempotencyKey: key, notBefore: dueAt },
						),
				);
			const first = await acceptA(`first-${suffix}`);
			const second = await acceptA(`second-${suffix}`);
			const third = await appA.execution(
				{
					principal: buildA.principal,
					context: { tenantId: `tenant-${suffix}` },
				},
				({ mutations }) =>
					mutations.pin.accept(
						{ key: `mutation-${suffix}`, notBefore: dueAt },
						{ callId: `mutation-${suffix}` },
					),
			);
			const [reactionRun] = await database`SELECT run_id::text AS id,
				runtime_build_digest AS build FROM questpie_internal.durable_runs
				WHERE application_name = ${applicationIdentity} AND resource_identity = 'reaction:pinReaction'`;
			expect(reactionRun.build).toBe(buildA.runtimeBuildDigest);
			const fourth = await acceptA(`fourth-${suffix}`);
			await Bun.sleep(300);

			const bTrace = await appB.durable.poll({
				claimBatch: 1,
				workerId: `worker-b-${suffix}`,
			});
			const bRun = bTrace.outcomes[0]?.runId ?? null;
			const probeRun = bRun ?? first.runId;
			const bView = await appB.durable.inspect(probeRun);
			const aTrace = await appA.durable.poll({
				claimBatch: 1,
				workerId: `worker-a-${suffix}`,
			});
			const retainedRun = aTrace.outcomes[0]?.runId ?? second.runId;
			const [storedA] = await database!.unsafe<
				readonly Readonly<{ runtimeBuildDigest: string }>[]
			>(
				`SELECT runtime_build_digest AS "runtimeBuildDigest"
				 FROM questpie_internal.durable_runs
				 WHERE application_name = $1 AND run_id = $2`,
				[applicationIdentity, probeRun],
			);
			const aView = await appA.durable.inspect(retainedRun);
			await appA.close();
			applications.delete(appA);
			const backlog = [
				first,
				second,
				third,
				fourth,
				{ runId: reactionRun.id as string },
			].filter(({ runId }) => runId !== bRun && runId !== retainedRun);
			expect(backlog.length).toBeGreaterThan(1);
			const acceptedB = await appB.execution(
				{
					principal: buildB.principal,
					context: { tenantId: `tenant-${suffix}` },
				},
				({ jobs }) =>
					jobs.pin.worker.accept(
						{},
						{
							idempotencyKey: `build-b-${suffix}`,
							notBefore: new Date(Date.now() + 250),
						},
					),
			);
			await Bun.sleep(300);
			const bBacklogTrace = await appB.durable.poll({
				claimBatch: 1,
				workerId: `worker-b-backlog-${suffix}`,
			});
			expect(bBacklogTrace.outcomes.map(({ runId }) => runId)).toEqual([
				acceptedB.runId,
			]);
			expect(marker(await appB.durable.inspect(acceptedB.runId))).toBe("B");
			for (const { runId } of backlog)
				expect(await appB.durable.inspect(runId)).toMatchObject({
					attemptCount: 0,
				});
			const restartedA = await create(await importBuild(rootA));
			const restartTrace = await restartedA.durable.poll({
				claimBatch: 1,
				workerId: `worker-a-restarted-${suffix}`,
			});
			expect(restartTrace.claimed).toBe(1);
			const recoveredRun = restartTrace.outcomes[0]!.runId;
			expect(backlog.map(({ runId }) => runId)).toContain(recoveredRun);
			expect(marker(await restartedA.durable.inspect(recoveredRun))).toBe("A");
			// Complete all retained A work, including the Mutation-owned Job and Reaction.
			await restartedA.durable.poll({
				claimBatch: 64,
				workerId: `worker-a-drain-${suffix}`,
			});
			expect(marker(await restartedA.durable.inspect(third.runId))).toBe("A");
			expect(marker(await restartedA.durable.inspect(reactionRun.id))).toBe(
				"A",
			);

			expect({
				buildsDiffer: buildA.runtimeBuildDigest !== buildB.runtimeBuildDigest,
				contractsEqual: buildA.jobContractDigest === buildB.jobContractDigest,
				storedBuildIsA:
					storedA?.runtimeBuildDigest === buildA.runtimeBuildDigest,
				bClaimed: bTrace.claimed,
				bRefusedIncompatible: bTrace.refusedIncompatible,
				bMarker: marker(bView),
				bAttemptCount: bView?.attemptCount ?? null,
				aClaimed: aTrace.claimed,
				aMarker: marker(aView),
			}).toEqual({
				buildsDiffer: true,
				contractsEqual: true,
				storedBuildIsA: true,
				bClaimed: 0,
				bRefusedIncompatible: 0,
				bMarker: null,
				bAttemptCount: 0,
				aClaimed: 1,
				aMarker: "A",
			});
		} catch (error) {
			failures.push(error);
		} finally {
			const cleanupErrors = failures;
			const closeResults = await Promise.allSettled(
				[...applications].map((application) => application.close()),
			);
			for (const result of closeResults)
				if (result.status === "rejected") cleanupErrors.push(result.reason);
			try {
				try {
					await database?.close({ timeout: 0 });
				} catch (error) {
					cleanupErrors.push(error);
				} finally {
					if (ownsDatabase) {
						try {
							await admin!.unsafe(
								`DROP DATABASE "${databaseName}" WITH (FORCE)`,
							);
						} catch (error) {
							cleanupErrors.push(error);
						}
					}
				}
			} finally {
				if (previousDatabaseName === undefined) delete process.env.PGDATABASE;
				else process.env.PGDATABASE = previousDatabaseName;
				const removed = await Promise.allSettled([
					rm(temporaryRoot, { recursive: true, force: true }),
				]);
				for (const result of removed)
					if (result.status === "rejected") cleanupErrors.push(result.reason);
			}
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1)
			throw new AggregateError(
				failures,
				"executable-pin tracer and cleanup failures",
			);
	},
	120_000,
);
