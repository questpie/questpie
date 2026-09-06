import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

type Artifacts = typeof import("../../runtime/src/application/artifacts");
type ArtifactFiles =
	typeof import("../../runtime/src/application/artifact-files");
type Postgres = typeof import("../../runtime/src/postgres");
type Prerequisites =
	typeof import("../../runtime/src/application/postgres-readiness-prerequisites");
type Readiness = typeof import("../../compiler/src/runtime/postgres-readiness");
type Schema = typeof import("../../compiler/src/schema");
type Canonical = typeof import("../../compiler/src/canonical");
type Schedules = typeof import("../../runtime/src/durable/schedule");

/** Deployment activation is explicit; decimal revisions never pass through Number. */
export function requestedScheduleRevision(args: readonly string[]): string {
	const value = args[2];
	if (
		args.length !== 3 ||
		args[0] !== "activate" ||
		args[1] !== "--expect-revision" ||
		typeof value !== "string" ||
		!/^(?:0|[1-9][0-9]*)$/u.test(value) ||
		value.length > 19 ||
		BigInt(value) > 9223372036854775807n
	)
		throw new Error("SCHEDULE_ARGUMENTS_INVALID");
	return value;
}

function invalid(): never {
	throw new Error("SCHEDULE_ARTIFACT_INVALID");
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
	return value as Record<string, unknown>;
}

/** Load the complete local checksum set once; executable bytes are data only. */
async function generatedFiles(
	root: string,
): Promise<ReadonlyMap<string, Uint8Array>> {
	const directory = resolve(root, ".questpie/generated");
	const checksumPath = "internal/checksums.json";
	const paths: string[] = [];
	async function walk(relative: string): Promise<void> {
		for (const entry of await readdir(join(directory, relative), {
			withFileTypes: true,
		})) {
			const path = relative ? `${relative}/${entry.name}` : entry.name;
			if (entry.isDirectory()) await walk(path);
			else if (entry.isFile()) paths.push(path);
			else invalid();
		}
	}
	await walk("");
	const checksums = record(
		JSON.parse(await readFile(join(directory, checksumPath), "utf8")),
	);
	if (
		Object.keys(checksums).sort().join(",") !== "files,format,version" ||
		checksums.format !== "questpie.generated-checksums" ||
		checksums.version !== 1 ||
		!Array.isArray(checksums.files)
	)
		invalid();
	const files = new Map<string, Uint8Array>();
	let previous = "";
	for (const raw of checksums.files) {
		const entry = record(raw);
		const path = entry.path;
		if (
			Object.keys(entry).sort().join(",") !== "digest,path" ||
			typeof path !== "string" ||
			path <= previous ||
			path === checksumPath ||
			!/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/u.test(path) ||
			path.split("/").some((part) => part === "." || part === "..") ||
			typeof entry.digest !== "string" ||
			!/^[a-f0-9]{64}$/u.test(entry.digest)
		)
			invalid();
		previous = path;
		if (!paths.includes(path)) invalid();
		const bytes = await readFile(join(directory, path));
		if (createHash("sha256").update(bytes).digest("hex") !== entry.digest)
			invalid();
		files.set(path, bytes);
	}
	if (paths.length !== files.size + 1 || !paths.includes(checksumPath))
		invalid();
	return files;
}

/** Private deployment seam: verify the complete build, then use the one activation owner. */
export async function activateScheduleFromDirectory(
	input: Readonly<{
		root: string;
		connectionString: string;
		expectedRevision: string;
	}>,
) {
	requestedScheduleRevision([
		"activate",
		"--expect-revision",
		input.expectedRevision,
	]);
	const artifactsApi: Artifacts = await import(
		new URL("./internal/runtime/application/artifacts.js", import.meta.url).href
	);
	const artifactFilesApi: ArtifactFiles = await import(
		new URL("./internal/runtime/application/artifact-files.js", import.meta.url)
			.href
	);
	const schemaApi: Schema = await import(
		new URL("./internal/compiler/schema/index.js", import.meta.url).href
	);
	const canonical: Canonical = await import(
		new URL("./internal/compiler/canonical.js", import.meta.url).href
	);
	const schedulesApi: Schedules = await import(
		new URL("./internal/runtime/durable/schedule/index.js", import.meta.url)
			.href
	);
	const verified = await (async () => {
		try {
			const files = await generatedFiles(input.root);
			const json = (path: string): unknown => {
				const bytes = files.get(path);
				if (!bytes) invalid();
				return JSON.parse(
					new TextDecoder("utf-8", { fatal: true }).decode(bytes),
				);
			};
			const artifacts = artifactsApi.decodeRuntimeArtifacts({
				runtimeBuild: json("runtime-build.json"),
				runtimeExecutables: json("runtime-executables.json"),
				operationContracts: json("operation-contracts.json"),
				httpContract: json("operation-http-contract.json"),
			});
			const build = artifacts.runtimeBuild;
			artifactFilesApi.verifyRuntimeArtifactFiles(
				artifacts,
				Object.fromEntries(
					build.inventory.map(({ path }) => {
						const bytes = files.get(path);
						if (!bytes) invalid();
						return [path, bytes];
					}),
				),
			);
			const schema = schemaApi.assertProjection(
				json("schema-projection.json"),
				"verified deployment schema",
			);
			if (`application:${schema.application.name}` !== build.application)
				invalid();
			const bindings = {
				application: build.application,
				compilerRuntimeBuildDigest: build.compilerRuntimeBuildDigest,
				jobProjectionDigest:
					build.later.jobDigest ??
					canonical.digest("questpie-job-projection-v1", {
						format: "questpie.job-projection",
						version: 1,
						jobs: [],
					}),
			};
			const artifact = schedulesApi.verifyStaticScheduleArtifact(
				json("job-schedules.json"),
				bindings,
			);
			return {
				artifact,
				bindings,
				schema,
				build,
				committedMigrations: json("committed-migrations.json"),
			};
		} catch {
			invalid();
		}
	})();
	const postgres: Postgres = await import(
		new URL("./internal/runtime/postgres/index.js", import.meta.url).href
	);
	const prerequisites: Prerequisites = await import(
		new URL(
			"./internal/runtime/application/postgres-readiness-prerequisites.js",
			import.meta.url,
		).href
	);
	const readiness: Readiness = await import(
		new URL(
			"./internal/compiler/runtime/postgres-readiness.js",
			import.meta.url,
		).href
	);
	const database = postgres.createRuntimePostgres({
		connectionUrl: input.connectionString,
		directConnectionUrl: input.connectionString,
		pool: {
			max: 1,
			connectTimeoutMs: 5000,
			checkoutTimeoutMs: 5000,
			idleTimeoutMs: 5000,
			maxLifetimeSeconds: 30,
		},
		timeouts: { statementMs: 5000, lockMs: 1000, idleInTransactionMs: 5000 },
	});
	try {
		try {
			await readiness.verifyPostgresDatabaseRuntimeReadiness({
				database,
				runtime: {
					definePostgresAdministrativeStatement:
						postgres.definePostgresAdministrativeStatement,
					definePostgresStatement: postgres.definePostgresStatement,
					verifyReadinessPrerequisites:
						prerequisites.verifyPostgresDatabaseReadinessPrerequisitesInOwnedTransaction,
				},
				schema: verified.schema,
				committedMigrations: verified.committedMigrations,
				expected: verified.build,
			});
		} catch {
			throw new Error("SCHEDULE_DATABASE_NOT_READY");
		}
		return await schedulesApi
			.createPostgresStaticSchedules({
				database,
				artifact: verified.artifact,
				bindings: verified.bindings,
				accept: async () => {
					throw new Error("activation cannot accept Jobs");
				},
			})
			.activate({ expectedRevision: input.expectedRevision });
	} finally {
		await database.close({ deadlineAt: Date.now() + 5000 });
	}
}

/** Never print raw driver, filesystem, Context, input, or executable diagnostics. */
export function scheduleFailureMessage(error: unknown): string {
	const allowed = new Set([
		"SCHEDULE_ARGUMENTS_INVALID",
		"SCHEDULE_ARTIFACT_INVALID",
		"SCHEDULE_DATABASE_NOT_READY",
		"SCHEDULE_ACTIVATION_STALE",
		"SCHEDULE_REVISION_OVERFLOW",
		"SCHEDULE_STATE_INVALID",
	]);
	if (!(error instanceof Error) || !allowed.has(error.message))
		return "SCHEDULE_ACTIVATION_FAILED";
	if (error.message === "SCHEDULE_ACTIVATION_STALE" && "currentHead" in error) {
		if (
			!error.currentHead ||
			typeof error.currentHead !== "object" ||
			Array.isArray(error.currentHead)
		)
			return error.message;
		const head = record(error.currentHead);
		if (
			typeof head.revision === "string" &&
			/^(?:0|[1-9][0-9]*)$/u.test(head.revision) &&
			typeof head.targetDigest === "string" &&
			/^[a-f0-9]{64}$/u.test(head.targetDigest)
		)
			return `${error.message} ${JSON.stringify({ revision: head.revision, targetDigest: head.targetDigest })}`;
	}
	return error.message;
}
