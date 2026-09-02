import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
	canonicalBytes,
	compareAscii,
	contentDigest,
	digest,
} from "../canonical";
import { projectJobContracts, type JobProjectionV1 } from "../job";
import {
	durableKernelContract,
	durableKernelDigest,
	projectReactionContracts,
	type DurableKernelContractV1,
	type ReactionProjectionV2,
} from "../reaction";
import type { ApplicationConfiguration, NormalizedResource } from "../types";

export { renderClientContract, renderCodecType } from "./client";
export { projectRealtimeWireContract } from "./realtime-wire";
export {
	renderApplicationBundle,
	renderApplicationDeclaration,
} from "./application";

type ArtifactFiles = Readonly<Record<string, string>>;

interface RuntimeExecutableSlotV1 {
	readonly identity: string;
	readonly kind: string;
	readonly slot: string;
	readonly origin: Readonly<{
		path: string;
		exportName: string;
		packageId: string | null;
	}>;
	readonly sourceDigest: string;
	readonly contractDigest: string;
	readonly runtimeGraphDigest: string;
	readonly bundleExport: string;
}

export interface RuntimeContractProjection {
	readonly clientContract: Readonly<Record<string, unknown>>;
	readonly clientContractDigest: string;
	readonly operationContracts: Readonly<{
		format: "questpie.operation-contracts";
		version: 1;
		operations: readonly Readonly<Record<string, unknown>>[];
	}>;
	readonly operationContractsDigest: string;
	readonly executables: Readonly<{
		format: "questpie.runtime-executables";
		version: 1;
		slots: readonly RuntimeExecutableSlotV1[];
	}>;
	readonly runtimeExecutablesDigest: string;
	readonly reactions: ReactionProjectionV2;
	readonly reactionDigest: string;
	readonly jobs: JobProjectionV1;
	readonly jobDigest: string;
	readonly durableKernel: DurableKernelContractV1;
	readonly http: Readonly<Record<string, unknown>>;
	readonly httpContractDigest: string;
}

export function projectCompilerRuntimeBuild(buildInputDigest: string) {
	const compiler = Object.freeze({
		version: "4.0.0-beta.1",
		bunVersion: Bun.version,
		buildInputDigest,
		executableFormat: "bun-esm-bundle-v1",
	});
	return Object.freeze({
		compiler,
		digest: digest("questpie-compiler-runtime-build-v1", compiler),
	});
}

function mutationAdmission(
	resource: NormalizedResource,
): "authenticated" | "public" | "system" {
	const policy = resource.contract.policy;
	if (!policy || typeof policy !== "object" || Array.isArray(policy))
		throw new TypeError("normalized Mutation admission is invalid");
	const admission = (policy as Readonly<{ kind?: unknown }>).kind;
	if (
		!(["authenticated", "public", "system"] as const).includes(
			admission as never,
		)
	)
		throw new TypeError("normalized Mutation admission is invalid");
	return admission as "authenticated" | "public" | "system";
}

function mutationIssueMappings(
	resource: NormalizedResource,
	resources: readonly NormalizedResource[],
) {
	const authoredMappings = Object.entries(
		(resource.contract.issueMappings ?? {}) as Readonly<
			Record<string, Readonly<Record<string, string>>>
		>,
	);
	if (authoredMappings.length === 0) return undefined;
	return Object.fromEntries(
		authoredMappings
			.sort(([left], [right]) => compareAscii(left, right))
			.map(([collectionName, issues]) => {
				const collection = resources.find(
					(candidate) =>
						candidate.kind === "collection" &&
						candidate.name === collectionName,
				);
				if (!collection)
					throw new TypeError(
						`Mutation issue mapping names unknown Collection ${collectionName}`,
					);
				const identities = (collection.contract.issues ?? {}) as Readonly<
					Record<string, string>
				>;
				return [
					collection.identity,
					Object.fromEntries(
						Object.entries(issues)
							.sort(([left], [right]) => compareAscii(left, right))
							.map(([issueName, error]) => {
								const issue = identities[issueName];
								if (!issue)
									throw new TypeError(
										`Mutation issue mapping names unknown Issue ${collectionName}.${issueName}`,
									);
								return [issue, error];
							}),
					),
				];
			}),
	);
}

function operationContracts(
	resources: readonly NormalizedResource[],
	exposure: "direct" | "network",
	includeAdmission = false,
) {
	return resources
		.filter(
			(resource) =>
				(resource.kind === "query" ||
					resource.kind === "mutation" ||
					resource.kind === "action") &&
				(exposure === "direct" || resource.contract.exposure === "network"),
		)
		.map((resource) => {
			const issueMappings =
				includeAdmission && resource.kind === "mutation"
					? mutationIssueMappings(resource, resources)
					: undefined;
			return {
				identity: resource.identity,
				input: resource.contract.input,
				output: resource.contract.output,
				declaredErrors: resource.contract.declaredErrors ?? {},
				...(includeAdmission && resource.kind === "mutation"
					? {
							admission: mutationAdmission(resource),
							...(issueMappings ? { issueMappings } : {}),
						}
					: includeAdmission && resource.kind === "action"
						? {
								admission: resource.contract.admission,
								limits: resource.contract.limits,
							}
						: {}),
			};
		})
		.sort((left, right) => compareAscii(left.identity, right.identity));
}

export function projectRuntimeContract(
	input: Readonly<{
		configuration: ApplicationConfiguration;
		resources: readonly NormalizedResource[];
		sourceGraph: readonly Readonly<{
			path: string;
			contentDigest: string;
			packageId: string | null;
		}>[];
		contextProjection: Readonly<Record<string, unknown>>;
	}>,
): RuntimeContractProjection {
	const application = `application:${input.configuration.application.name}`;
	const operations = operationContracts(input.resources, "network");
	// Every directly invocable Operation needs its codecs, including the
	// server-only ones the network wire deliberately never exposes.
	const operationContractsArtifact = {
		format: "questpie.operation-contracts" as const,
		version: 1 as const,
		operations: operationContracts(input.resources, "direct", true),
	};
	const reactions = projectReactionContracts(input.resources);
	const reactionDigest = digest("questpie-reaction-projection-v2", reactions);
	const jobs = projectJobContracts(input.resources);
	const jobDigest = digest("questpie-job-projection-v1", jobs);
	const clientContract = {
		format: "questpie.generated-client-contract",
		version: 1,
		application,
		context: input.contextProjection.context,
		operations,
	};
	const clientContractDigest = digest(
		"questpie-generated-client-contract-v1",
		clientContract,
	);
	const sourceDigests = new Map(
		input.sourceGraph.map((file) => [
			`${file.packageId ?? "application"}\u0000${file.path}`,
			file.contentDigest,
		]),
	);
	const slots = input.resources
		.filter((resource) =>
			[
				"action",
				"context",
				"credentialResolver",
				"job",
				"mutation",
				"query",
				"reaction",
				"route",
				"service",
			].includes(resource.kind),
		)
		.flatMap((resource) => {
			const origin = {
				path: resource.origin.logicalPath,
				exportName: resource.origin.exportName,
				packageId: resource.origin.packageId,
			};
			const sourceDigest = sourceDigests.get(
				`${origin.packageId ?? "application"}\u0000${origin.path}`,
			);
			if (!sourceDigest)
				throw new TypeError(`missing executable source ${origin.path}`);
			const contractDigest = digest(
				"questpie-executable-contract-v1",
				resource.contract,
			);
			const executableSlots =
				resource.kind === "action" ||
				resource.kind === "query" ||
				resource.kind === "mutation" ||
				resource.kind === "route"
					? ["handler"]
					: (resource.contract.executableSlots as readonly string[]);
			return executableSlots.map((slot) => {
				const dependencyGraph =
					resource.kind === "service"
						? (
								resource.contract.dependencies as readonly Readonly<{
									identity: string;
								}>[]
							)
								.map((dependency) => dependency.identity)
								.toSorted(compareAscii)
						: [];
				const runtimeGraph = {
					identity: resource.identity,
					kind: resource.kind,
					slot,
					sourceDigest,
					contractDigest,
					dependencyGraph,
				};
				const runtimeGraphDigest = digest(
					"questpie-runtime-graph-v1",
					runtimeGraph,
				);
				return {
					identity: resource.identity,
					kind: resource.kind,
					slot,
					origin,
					sourceDigest,
					contractDigest,
					runtimeGraphDigest,
					bundleExport: `qp_${resource.identity.replace(/[^A-Za-z0-9]/g, "_")}_${slot}_${runtimeGraphDigest.slice(0, 12)}`,
				};
			});
		})
		.sort((left, right) =>
			compareAscii(
				`${left.identity}#${left.slot}`,
				`${right.identity}#${right.slot}`,
			),
		);
	const executables = {
		format: "questpie.runtime-executables" as const,
		version: 1 as const,
		slots,
	};
	const runtimeExecutablesDigest = digest(
		"questpie-runtime-executables-v1",
		executables,
	);
	const httpWithoutDigest = {
		format: "questpie.operation-http" as const,
		version: 1 as const,
		application,
		operations,
		failures: [
			"APPLICATION_MISMATCH",
			"CLIENT_OUTDATED",
			"COMMITTED_RESULT_UNAVAILABLE",
			"DEADLINE_EXCEEDED",
			"INTERNAL",
			"NOT_FOUND",
			"PROTOCOL_UNSUPPORTED",
			"RESOURCE_LIMIT",
			"RUNTIME_UNAVAILABLE",
		],
		limits: { requestBytes: 1_048_576, responseBytes: 1_048_576 },
		principalSource: "ingressOutsideBody",
		mutationAutomaticRetry: false,
		clientContractDigest,
	};
	const http = {
		...httpWithoutDigest,
		digest: digest("questpie-operation-http-v1", httpWithoutDigest),
	};
	return {
		clientContract,
		clientContractDigest,
		operationContracts: operationContractsArtifact,
		operationContractsDigest: digest(
			"questpie-operation-contracts-v1",
			operationContractsArtifact,
		),
		durableKernel: durableKernelContract,
		executables,
		runtimeExecutablesDigest,
		reactions,
		reactionDigest,
		jobs,
		jobDigest,
		http,
		httpContractDigest: http.digest,
	};
}

export async function projectCommittedMigrations(applicationRoot: string) {
	const root = join(applicationRoot, "questpie/migrations");
	let directories: string[] = [];
	try {
		directories = (await readdir(root, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort(compareAscii);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const migrations = await Promise.all(
		directories.map(async (directory) => {
			const artifact = JSON.parse(
				await readFile(join(root, directory, "migration.json"), "utf8"),
			) as Readonly<{
				identity: string;
				parent: string | null;
				sequence: number;
			}>;
			const checksum = (
				await readFile(join(root, directory, "checksum.sha256"), "utf8")
			).trim();
			return {
				identity: artifact.identity,
				parent: artifact.parent,
				sequence: artifact.sequence,
				checksum,
			};
		}),
	);
	migrations.sort((left, right) => left.sequence - right.sequence);
	return {
		format: "questpie.committed-migrations",
		version: 1,
		head: migrations.at(-1)?.identity ?? null,
		migrations,
	};
}

export function projectRuntimeBuild(
	input: Readonly<{
		configuration: ApplicationConfiguration;
		files: ArtifactFiles;
		runtime: RuntimeContractProjection;
		migrationHead: string | null;
		schemaFingerprint: string;
		liveQueryDigests: Readonly<{
			changeLedger: string;
			resume: string;
		}>;
		realtimeWireDigest: string;
		postgresContextBootstrapPlansDigest: string;
		postgresMutationTransactionStatementsDigest: string;
		postgresCollectionOperationPlansDigest: string;
		observationSignalProjectionDigest: string;
	}>,
): Readonly<Record<string, unknown>> {
	const fileDigest = (path: string): string | null => {
		const bytes = input.files[path];
		return bytes === undefined ? null : contentDigest(bytes);
	};
	const inventory = Object.entries(input.files)
		.filter(
			([path]) =>
				path !== "runtime-build.json" && path !== "internal/checksums.json",
		)
		.map(([path, bytes]) => ({ path, digest: contentDigest(bytes) }))
		.sort((left, right) => compareAscii(left.path, right.path));
	const buildInputDigest = fileDigest("build-input.json");
	if (!buildInputDigest)
		throw new TypeError("Runtime Build requires build-input.json");
	const compilerRuntimeBuild = projectCompilerRuntimeBuild(buildInputDigest);
	const slots = input.runtime.executables.slots as readonly Readonly<{
		identity: string;
		kind: string;
		slot: string;
		runtimeGraphDigest: string;
		bundleExport: string;
	}>[];
	const runtimeGraphDigest = digest(
		"questpie-runtime-graphs-v1",
		slots.map(({ identity, slot, runtimeGraphDigest: graph }) => ({
			identity,
			slot,
			runtimeGraphDigest: graph,
		})),
	);
	const withoutDigest = {
		format: "questpie.runtime-build",
		version: 1,
		application: `application:${input.configuration.application.name}`,
		runtimeAbi: "questpie.runtime.v1",
		internalProtocol: "questpie.internal.v7",
		compiler: compilerRuntimeBuild.compiler,
		compilerRuntimeBuildDigest: compilerRuntimeBuild.digest,
		manifestDigest: fileDigest("manifest.json"),
		appContractDigest: fileDigest("app.ts"),
		clientContractDigest: input.runtime.clientContractDigest,
		packageInventoryDigest: fileDigest("internal/package-inventories.json"),
		schemaProjectionDigest: fileDigest("schema-projection.json"),
		schemaFingerprint: input.schemaFingerprint,
		policyProjectionDigest: fileDigest("policy-projection.json"),
		queryProjectionDigest: fileDigest("query-projection.json"),
		postgresQueryPlansDigest: fileDigest("postgres-query-plans.json"),
		postgresContextBootstrapPlansDigest:
			input.postgresContextBootstrapPlansDigest,
		postgresMutationTransactionStatementsDigest:
			input.postgresMutationTransactionStatementsDigest,
		postgresCollectionOperationPlansDigest:
			input.postgresCollectionOperationPlansDigest,
		observationSignalProjectionDigest: input.observationSignalProjectionDigest,
		committedMigrationsDigest: fileDigest("committed-migrations.json"),
		migrationHead: input.migrationHead,
		serverBundleDigest: fileDigest("internal/application.js"),
		runtimeExecutablesDigest: input.runtime.runtimeExecutablesDigest,
		operationContractsDigest: input.runtime.operationContractsDigest,
		runtimeGraphDigest,
		operationHttpContractDigest: input.runtime.httpContractDigest,
		realtimeWireDigest: input.realtimeWireDigest,
		executableSlots: slots.map((slot) => `${slot.identity}#${slot.slot}`),
		slots: slots.map(
			({ identity, kind, slot, runtimeGraphDigest, bundleExport }) => ({
				identity,
				kind,
				slot,
				runtimeGraphDigest,
				bundleExport,
			}),
		),
		later: {
			changeLedgerDigest: input.liveQueryDigests.changeLedger,
			resumeDigest: input.liveQueryDigests.resume,
			durableCompatibilityDigest:
				input.runtime.reactions.reactions.length === 0 &&
				input.runtime.jobs.jobs.length === 0
					? null
					: durableKernelDigest,
			reactionDigest:
				input.runtime.reactions.reactions.length === 0
					? null
					: input.runtime.reactionDigest,
			jobDigest:
				input.runtime.jobs.jobs.length === 0 ? null : input.runtime.jobDigest,
		},
		inventory,
	};
	return {
		...withoutDigest,
		digest: digest("questpie-runtime-build-v1", withoutDigest),
	};
}

export function runtimeArtifactBytes(value: unknown): string {
	return canonicalBytes(value);
}
