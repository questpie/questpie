import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
	canonicalBytes,
	compareAscii,
	contentDigest,
	digest,
} from "../canonical";
import {
	projectReactionContracts,
	type ReactionProjectionV1,
} from "../reaction";
import type { ApplicationConfiguration, NormalizedResource } from "../types";

export { renderClientContract, renderCodecType } from "./client";
export {
	projectRealtimeWireContract,
	type RealtimeWireContractV1,
} from "./realtime-wire";
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
	readonly executables: Readonly<{
		format: "questpie.runtime-executables";
		version: 1;
		slots: readonly RuntimeExecutableSlotV1[];
	}>;
	readonly runtimeExecutablesDigest: string;
	readonly reactions: ReactionProjectionV1;
	readonly reactionDigest: string;
	readonly wire: Readonly<Record<string, unknown>>;
	readonly wireDigest: string;
}

function operationContracts(resources: readonly NormalizedResource[]) {
	return resources
		.filter(
			(resource) =>
				(resource.kind === "query" || resource.kind === "mutation") &&
				resource.contract.exposure === "network",
		)
		.map((resource) => ({
			identity: resource.identity,
			input: resource.contract.input,
			output: resource.contract.output,
			declaredErrors: resource.contract.declaredErrors ?? {},
		}))
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
	const operations = operationContracts(input.resources);
	const reactions = projectReactionContracts(input.resources);
	const reactionDigest = digest("questpie-reaction-projection-v1", reactions);
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
			["context", "mutation", "query", "service"].includes(resource.kind),
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
				resource.kind === "query" || resource.kind === "mutation"
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
	const wireV1WithoutDigest = {
		format: "questpie.operation-wire",
		version: 1,
		application,
		path: "/_questpie/operation",
		mediaType: "application/vnd.questpie.operation+json;version=1",
		protocol: { name: "questpie.operation", version: 1 },
		requestKeys: [
			"application",
			"callId",
			"clientContractDigest",
			"context",
			"input",
			"operation",
			"protocol",
			"timeoutMilliseconds",
			"wireDigest",
		],
		responseKeys: {
			result: ["callId", "kind", "operation", "payload", "protocol"],
			declaredError: ["callId", "error", "kind", "operation", "protocol"],
			failure: ["callId", "error", "kind", "operation", "protocol"],
			rejection: ["error", "kind"],
		},
		operations,
		failures: [
			"APPLICATION_MISMATCH",
			"CLIENT_OUTDATED",
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
	const wireV1Digest = digest(
		"questpie-operation-wire-v1",
		wireV1WithoutDigest,
	);
	const wireWithoutDigest = {
		...wireV1WithoutDigest,
		version: 2,
		resultKinds: ["declaredError", "failure", "result"],
		failureDetails: {
			ordinary: ["code", "retryable"],
			committedResultUnavailable: ["code", "retryable", "transactionId"],
		},
		callIdentity: {
			kind: "text",
			minimumUnicodeScalars: 1,
			maximumUnicodeScalars: 256,
			maximumUtf8Bytes: 1_024,
			normalization: "NFC",
			normalizationBehavior: "rejectNotRewrite",
			loneSurrogates: "forbidden",
			nullScalar: "forbidden",
			uuidRequired: false,
			runtimeDefaultWhenAbsent: "crypto.randomUUID",
			equality: "exactUtf8AfterValidation",
		},
		transactionIdentity: {
			kind: "postgresXid8Text",
			canonicalPattern: "^[1-9][0-9]{0,19}$",
			maximum: "18446744073709551615",
			clientInterpretation: "opaque",
		},
		committedResultUnavailable: {
			classification: "frameworkTransactionOutcome",
			httpStatus: 500,
			retryable: true,
			transactionOutcome: "committed",
			automaticRetry: false,
			recovery: "replayExactMutationWithSameCallIdentity",
			frameCallIdSource: "acceptedRequest",
			transactionIdSource: "committedReceipt",
			causeDisclosure: "forbidden",
		},
		compatibility: {
			clientContractDigest,
			wireV1Digest,
			wireV1Source: "sameApplicationClientContractAndOperations",
			wireV1MutationExecution: "rejectBeforeContextAndOperation",
			wireV1QueryExecution: "allowed",
			wireV1RejectionCode: "CLIENT_OUTDATED",
		},
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
	};
	const wireDigest = digest("questpie-operation-wire-v2", wireWithoutDigest);
	return {
		clientContract,
		clientContractDigest,
		executables,
		runtimeExecutablesDigest,
		reactions,
		reactionDigest,
		wire: { ...wireWithoutDigest, digest: wireDigest },
		wireDigest,
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
	const compiler = {
		version: "4.0.0-beta.1",
		bunVersion: Bun.version,
		buildInputDigest: fileDigest("build-input.json"),
		executableFormat: "bun-esm-bundle-v1",
	};
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
		internalProtocol: "questpie.internal.v3",
		compiler,
		compilerRuntimeBuildDigest: digest(
			"questpie-compiler-runtime-build-v1",
			compiler,
		),
		manifestDigest: fileDigest("manifest.json"),
		appContractDigest: fileDigest("app.ts"),
		clientContractDigest: input.runtime.clientContractDigest,
		packageInventoryDigest: fileDigest("internal/package-inventories.json"),
		schemaProjectionDigest: fileDigest("schema-projection.json"),
		schemaFingerprint: input.schemaFingerprint,
		policyProjectionDigest: fileDigest("policy-projection.json"),
		queryProjectionDigest: fileDigest("query-projection.json"),
		postgresQueryPlansDigest: fileDigest("postgres-query-plans.json"),
		committedMigrationsDigest: fileDigest("committed-migrations.json"),
		migrationHead: input.migrationHead,
		serverBundleDigest: fileDigest("internal/application.js"),
		runtimeExecutablesDigest: input.runtime.runtimeExecutablesDigest,
		runtimeGraphDigest,
		wireDigest: input.runtime.wireDigest,
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
			durableCompatibilityDigest: null,
			reactionDigest:
				input.runtime.reactions.reactions.length === 0
					? null
					: input.runtime.reactionDigest,
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
