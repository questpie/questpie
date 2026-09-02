import { actionServiceResources, executionServiceResources } from "../action";
import { compareAscii } from "../canonical";
import { renderServerOperationValue } from "../server-operation-map";
import type {
	ApplicationConfiguration,
	NormalizedResource,
	PackageInventory,
} from "../types";
import { bundleApplicationEntry } from "./application-bundle";
import { renderGeneratedCollectionOperationBindings } from "./application-collection-operations";
import { renderDurableWorkerOwner } from "./application-durable";
import {
	renderDirectJobAcceptance,
	renderDirectJobOperations,
} from "./application-jobs";
import * as emptyDurableProjections from "./empty-durable-projections";
import * as postgresRuntimeTemplates from "./postgres-runtime-ownership";

type RuntimeExecutableSlot = Readonly<{
	identity: string;
	kind: string;
	slot: string;
	origin: Readonly<{
		path: string;
		exportName: string;
		packageId: string | null;
	}>;
	sourceDigest: string;
	contractDigest: string;
	runtimeGraphDigest: string;
	bundleExport: string;
}>;

type RecordValue = Readonly<Record<string, unknown>>;

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${label} must be an object`);
	return value as RecordValue;
}

function sourceModule(
	origin: RuntimeExecutableSlot["origin"],
	configuration: ApplicationConfiguration,
	inventories: readonly PackageInventory[],
): string {
	if (origin.packageId) {
		const inventory = inventories.find(
			(candidate) => candidate.package.id === origin.packageId,
		);
		if (!inventory)
			throw new TypeError(`missing executable Package ${origin.packageId}`);
		return `${inventory.package.name}/questpie`;
	}
	const prefix =
		configuration.source.root === "."
			? ""
			: `${configuration.source.root.replace(/\/$/, "")}/`;
	const path = origin.path.startsWith(prefix)
		? origin.path.slice(prefix.length)
		: origin.path;
	return `#questpie/source/${path}`;
}

function applicationEntry(
	input: Readonly<{
		configuration: ApplicationConfiguration;
		resources: readonly NormalizedResource[];
		slots: readonly RuntimeExecutableSlot[];
		inventories: readonly PackageInventory[];
		queryProjection: unknown;
		schemaProjection: unknown;
		contextBootstrapPlansDigest: string;
		mutationTransactionStatementsDigest: string;
		collectionOperationPlansDigest: string;
		collectionLifecycleProgramsDigest: string | null;
		collectionOperationArtifacts: boolean;
		collectionLifecycleArtifacts: boolean;
		collectionOperationAdapterArtifacts: boolean;
		reactionArtifact: boolean;
		jobArtifact: boolean;
		realtime: boolean;
	}>,
): string {
	const definitions = new Map<string, number>();
	const imports: string[] = [];
	const generatedOperations = renderGeneratedCollectionOperationBindings(
		input.resources,
	);
	const definitionName = (slot: RuntimeExecutableSlot): string => {
		const key = `${slot.origin.packageId ?? "application"}\0${slot.origin.path}\0${slot.origin.exportName}`;
		let index = definitions.get(key);
		if (index === undefined) {
			index = definitions.size;
			definitions.set(key, index);
			imports.push(
				`import { ${slot.origin.exportName} as definition${index} } from ${JSON.stringify(sourceModule(slot.origin, input.configuration, input.inventories))};`,
			);
		}
		return `definition${index}`;
	};
	const executable = (kind: string): boolean =>
		kind === "action" ||
		kind === "query" ||
		kind === "mutation" ||
		kind === "job" ||
		kind === "reaction" ||
		kind === "route";
	const bindingEntries = input.slots.map((slot) => {
		const definition =
			generatedOperations.definitionName(slot.identity) ?? definitionName(slot);
		const handler = executable(slot.kind);
		const implementation = handler
			? `${definition}.handler`
			: `${definition}.${slot.slot}`;
		return `Object.freeze({ identity: ${JSON.stringify(slot.identity)}, kind: ${JSON.stringify(slot.kind)}, slot: ${JSON.stringify(slot.slot)}, runtimeGraphDigest: ${JSON.stringify(slot.runtimeGraphDigest)}, bundleExport: ${JSON.stringify(slot.bundleExport)}, definition: ${definition}${handler ? `, execute: ${implementation}` : ""} })`;
	});
	const serverEntries = input.slots.map((slot) => {
		const definition =
			generatedOperations.definitionName(slot.identity) ?? definitionName(slot);
		const implementation = executable(slot.kind)
			? `${definition}.handler`
			: `${definition}.${slot.slot}`;
		return `${JSON.stringify(slot.bundleExport)}: ${implementation}`;
	});
	const contextSlot = input.slots.find((slot) => slot.kind === "context");
	if (!contextSlot) throw new TypeError("Runtime Application requires Context");
	const contextDefinition = definitionName(contextSlot);
	const serviceDefinitions = [
		...new Set(
			input.slots
				.filter((slot) => slot.kind === "service")
				.map((slot) => definitionName(slot)),
		),
	];
	const renderExecutionServiceEntries = (owner: "service" | "scope.service") =>
		executionServiceResources(input.resources)
			.toSorted((left, right) => compareAscii(left.name, right.name))
			.map((resource) => {
				const slot = input.slots.find(
					(candidate) =>
						candidate.kind === "service" &&
						candidate.identity === resource.identity,
				);
				if (!slot)
					throw new TypeError(
						`Runtime Application lacks Service slot ${resource.identity}`,
					);
				return `${JSON.stringify(resource.name)}: await ${owner}(${definitionName(slot)})`;
			})
			.join(",\n");
	const routeServiceEntries = input.resources
		.filter(
			(resource) =>
				resource.kind === "service" && resource.origin.packageId === null,
		)
		.sort((left, right) => compareAscii(left.identity, right.identity))
		.map((resource) => {
			const slot = input.slots.find(
				(candidate) =>
					candidate.kind === "service" &&
					candidate.identity === resource.identity,
			);
			if (!slot)
				throw new TypeError(
					`Runtime Application lacks Service slot ${resource.identity}`,
				);
			return `${JSON.stringify(resource.name)}: ${resource.contract.lifetime === "execution" ? `() => service(${definitionName(slot)})` : `await service(${definitionName(slot)})`}`;
		})
		.join(",\n");
	const credentialResolver = input.resources.find(
		(resource) => resource.kind === "credentialResolver",
	);
	const credentialResolverDefinition = credentialResolver
		? definitionName(
				input.slots.find(
					(slot) =>
						slot.identity === credentialResolver.identity &&
						slot.slot === "resolve",
				) ??
					(() => {
						throw new TypeError(
							`Runtime Application lacks credential resolver slot ${credentialResolver.identity}`,
						);
					})(),
			)
		: null;
	const routes = input.resources
		.filter((resource) => resource.kind === "route")
		.sort((left, right) => compareAscii(left.name, right.name));
	const routeBindings = routes
		.map((resource) => {
			const slot = input.slots.find(
				(candidate) =>
					candidate.identity === resource.identity &&
					candidate.slot === "handler",
			);
			if (!slot)
				throw new TypeError(
					`Runtime Application lacks Route slot ${resource.identity}`,
				);
			const definition = definitionName(slot);
			return `Object.freeze({ identity: ${JSON.stringify(resource.identity)}, method: ${JSON.stringify(resource.contract.method)}, path: ${JSON.stringify(resource.contract.path)}, credentials: ${JSON.stringify(resource.contract.credentials)}, admission: ${JSON.stringify(resource.contract.admission)}, limits: ${JSON.stringify(resource.contract.limits)}, execute: ${definition}.handler })`;
		})
		.join(",\n");
	const directRouteEntries = routes
		.map(
			(resource) =>
				`${JSON.stringify(resource.name)}: Object.freeze({ direct: (routeInput) => routeExecutor.direct(${JSON.stringify(resource.identity)}, routeInput) })`,
		)
		.join(",\n");
	const queries = input.resources
		.filter((resource) => resource.kind === "query")
		.sort((left, right) => compareAscii(left.name, right.name));
	const directQueries = renderServerOperationValue(
		"Query",
		queries.map((resource) => ({
			name: resource.name,
			origin: resource.origin,
			value: `(operationInput) => operations.invoke(${JSON.stringify(resource.identity)}, operationInput)`,
		})),
	);
	const mutations = input.resources
		.filter((resource) => resource.kind === "mutation")
		.sort((left, right) => compareAscii(left.name, right.name));
	const directMutations = renderServerOperationValue(
		"Mutation",
		mutations.map((resource) => ({
			name: resource.name,
			origin: resource.origin,
			value: `(operationInput, options) => operations.invoke(${JSON.stringify(resource.identity)}, operationInput, options)`,
		})),
	);
	const actions = input.resources
		.filter((resource) => resource.kind === "action")
		.sort((left, right) => compareAscii(left.name, right.name));
	const actionBindings = actions
		.map((resource) => {
			const slot = input.slots.find(
				(candidate) =>
					candidate.identity === resource.identity &&
					candidate.slot === "handler",
			);
			if (!slot)
				throw new TypeError(
					`Runtime Application lacks Action slot ${resource.identity}`,
				);
			const definition = definitionName(slot);
			return `(() => {
				const contract = actionContracts.get(${JSON.stringify(resource.identity)});
				if (!contract) throw new TypeError("generated Action contract is unavailable");
				return Object.freeze({
					identity: contract.identity,
					admission: contract.admission,
					limits: contract.limits,
					input: contract.input,
					output: contract.output,
					declaredErrors: Object.freeze(Object.entries(contract.declaredErrors).map(([key, error]) => Object.freeze({ key, code: error.code, status: error.status, payload: error.payload }))),
					execute: ${definition}.handler,
				});
			})()`;
		})
		.join(",\n");
	const directActions = renderServerOperationValue(
		"Action",
		actions.map((resource) => ({
			name: resource.name,
			origin: resource.origin,
			value: `(actionInput, options) => {
					const optionKeys = options && typeof options === "object" && !Array.isArray(options) ? Object.keys(options) : [];
					if (!Object.hasOwn(options ?? {}, "effectKey") || optionKeys.some((key) => key !== "effectKey" && key !== "callId" && key !== "timeoutMilliseconds"))
						throw new OperationFailure("PROTOCOL_UNSUPPORTED");
					return actions.invoke(${JSON.stringify(resource.identity)}, { input: actionInput, scope, ...options });
				}`,
		})),
	);
	const directJobs = renderDirectJobOperations(input.resources);
	const networkActionCases = actions
		.filter((resource) => resource.contract.exposure === "network")
		.map((resource) => {
			const access = resource.name
				.split(".")
				.map((segment) => `[${JSON.stringify(segment)}]`)
				.join("");
			return `case ${JSON.stringify(resource.identity)}:
				return createDirectActions(execution.actionScope, operations)${access}(actionInput, {
					effectKey,
					callId,
					...(timeoutMilliseconds === undefined ? {} : { timeoutMilliseconds }),
				});`;
		})
		.join("\n");
	const actionServiceEntries = actionServiceResources(input.resources)
		.toSorted((left, right) => compareAscii(left.identity, right.identity))
		.map((resource) => {
			const slot = input.slots.find(
				(candidate) =>
					candidate.kind === "service" &&
					candidate.identity === resource.identity,
			);
			if (!slot)
				throw new TypeError(
					`Runtime Application lacks Action Service slot ${resource.identity}`,
				);
			return `${JSON.stringify(resource.name)}: await service(${definitionName(slot)})`;
		})
		.join(",\n");
	const queryProjection = record(input.queryProjection, "Query Projection");
	const structuralQueries = queryProjection.queries as readonly RecordValue[];
	const structuralImports = structuralQueries.map((query, index) => {
		const origin = record(query.origin, "Query Origin");
		const module = sourceModule(
			{
				path: String(origin.path),
				exportName: String(origin.exportName),
				packageId: origin.packageId === null ? null : String(origin.packageId),
			},
			input.configuration,
			input.inventories,
		);
		return `import { ${String(origin.exportName)} as structuralQuery${index} } from ${JSON.stringify(module)};`;
	});
	const structuralEntries = structuralQueries
		.map(
			(query, index) =>
				`[structuralQuery${index}${query.identity === null ? "" : ".query"}, ${JSON.stringify(String(query.digest))}]`,
		)
		.join(",\n");
	const collectionDefinitions = input.resources
		.filter((resource) => resource.kind === "collection")
		.sort((left, right) => compareAscii(left.identity, right.identity))
		.map((resource, index) => {
			imports.push(
				`import { ${resource.origin.exportName} as collectionDefinition${index} } from ${JSON.stringify(
					sourceModule(
						{
							path: resource.origin.logicalPath,
							exportName: resource.origin.exportName,
							packageId: resource.origin.packageId,
						},
						input.configuration,
						input.inventories,
					),
				)};`,
			);
			return `collectionDefinition${index}`;
		})
		.join(", ");
	const emptyCollectionArtifacts = JSON.stringify({
		programs: {
			format: "questpie.collection-operation-programs",
			version: 1,
			operations: [],
		},
		normalizers: {
			format: "questpie.field-normalizer-programs",
			version: 1,
			programs: [],
		},
		serverValues: {
			format: "questpie.server-value-programs",
			version: 1,
			programs: [],
		},
		adapters: {
			format: "questpie.collection-operation-adapters",
			version: 1,
			adapters: [],
		},
		plans: {
			format: "questpie.postgres-collection-operation-plans",
			version: 1,
			plans: [],
			digest: input.collectionOperationPlansDigest,
		},
		policies: [],
	});
	const emptyFieldNormalizerPrograms = JSON.stringify({
		format: "questpie.field-normalizer-programs",
		version: 1,
		programs: [],
	});
	const emptyServerValuePrograms = JSON.stringify({
		format: "questpie.server-value-programs",
		version: 1,
		programs: [],
	});
	return `import { principal } from "questpie";
import { bindIngressPrincipal } from "questpie:runtime-ingress";
import { verifyPostgresDatabaseRuntimeReadiness } from "questpie:runtime-readiness";
${imports.join("\n")}
${structuralImports.join("\n")}

const schemaProjection = ${JSON.stringify(input.schemaProjection)};
const expectedContextBootstrapPlansDigest = ${JSON.stringify(input.contextBootstrapPlansDigest)};
const expectedMutationTransactionStatementsDigest = ${JSON.stringify(input.mutationTransactionStatementsDigest)};
const expectedCollectionOperationPlansDigest = ${JSON.stringify(input.collectionOperationPlansDigest)};
const expectedCollectionLifecycleProgramsDigest = ${JSON.stringify(input.collectionLifecycleProgramsDigest)};
const structuralQueryDigests = new Map([${structuralEntries}]);
const expectedQueryDigests = [...new Set(structuralQueryDigests.values())].sort();
${generatedOperations.definitions}
const serverExports = Object.freeze({${serverEntries.join(",\n")}});
const slotBindings = Object.freeze([${bindingEntries.join(",\n")}]);

async function loadRuntimeArtifacts() {
	const generatedRoot = new URL("../", import.meta.url);
	const runtimeBuildBytes = await Bun.file(new URL("runtime-build.json", generatedRoot)).text();
	const runtimeBuild = JSON.parse(runtimeBuildBytes);
	const artifactFiles = Object.fromEntries(await Promise.all(runtimeBuild.inventory.map(async ({ path }) => [
		path,
		await Bun.file(new URL(path, generatedRoot)).text(),
	])));
	return {
		artifacts: {
			runtimeBuild,
			runtimeExecutables: JSON.parse(artifactFiles["runtime-executables.json"]),
			operationContracts: JSON.parse(artifactFiles["operation-contracts.json"]),
			httpContract: JSON.parse(artifactFiles["operation-http-contract.json"]),
		},
		artifactFiles,
	};
}

function linkMutationArtifacts(runtimeModule, artifactFiles, compilerRuntimeBuildDigest) {
	const { linkCollectionMutationPrograms, linkCollectionOperationAdapters, linkJobProjection, linkPostgresCollectionOperationPlans, linkReactionProjection } = runtimeModule;
	const raw = ${
		input.collectionOperationArtifacts
			? `{
		programs: JSON.parse(artifactFiles["collection-operation-programs.json"]),
		normalizers: JSON.parse(artifactFiles["field-normalizer-programs.json"]),
		serverValues: JSON.parse(artifactFiles["server-value-programs.json"]),
		lifecycle: ${input.collectionLifecycleArtifacts ? 'JSON.parse(artifactFiles["collection-lifecycle-programs.json"])' : "null"},
		adapters: ${input.collectionOperationAdapterArtifacts ? 'JSON.parse(artifactFiles["collection-operation-adapters.json"])' : emptyCollectionArtifacts + ".adapters"},
		plans: JSON.parse(artifactFiles["postgres-collection-operation-plans.json"]),
		policies: JSON.parse(artifactFiles["policy-projection.json"]).policies.map(({ program }) => ({
			identity: program.identity,
			target: program.target,
		})),
	}`
			: emptyCollectionArtifacts
	};
	const operations = linkCollectionMutationPrograms({
		collectionOperations: raw.programs,
		fieldNormalizers: ${emptyFieldNormalizerPrograms},
		serverValues: ${emptyServerValuePrograms},
		lifecyclePrograms: raw.lifecycle,
		expectedLifecycleProgramsDigest: expectedCollectionLifecycleProgramsDigest,
		compilerRuntimeBuildDigest,
		policies: raw.policies,
	});
	return Object.freeze({
		collectionOperations: operations,
		collectionAdapters: linkCollectionOperationAdapters({
			artifact: raw.adapters,
			fieldNormalizers: raw.normalizers,
			serverValues: raw.serverValues,
			kernels: operations,
		}),
		collectionPlans: linkPostgresCollectionOperationPlans({
			artifact: raw.plans,
			operations,
			expectedDigest: expectedCollectionOperationPlansDigest,
		}),
		reactions: linkReactionProjection(${input.reactionArtifact ? `JSON.parse(artifactFiles["reaction-projection.json"])` : emptyDurableProjections.reactions}),
		jobs: linkJobProjection(${input.jobArtifact ? `JSON.parse(artifactFiles["job-projection.json"])` : emptyDurableProjections.jobs}),
	});
}

function linkLiveQueryArtifacts(runtimeModule, artifactFiles) {
	return runtimeModule.linkLiveQueryProgram({
		watchability: JSON.parse(artifactFiles["query-watchability.json"]),
		dependencyAlgebra: JSON.parse(artifactFiles["live-query-dependency-algebra.json"]),
		changeLedger: JSON.parse(artifactFiles["change-ledger.json"]),
		reconciliation: JSON.parse(artifactFiles["change-reconciliation.json"]),
		resume: JSON.parse(artifactFiles["live-query-resume.json"]),
		captureBoundary: JSON.parse(artifactFiles["change-capture-boundary.json"]),
		limits: JSON.parse(artifactFiles["live-query-limits.json"]),
	});
}
export const bindIngressPrincipalForRequest = bindIngressPrincipal;

export async function createApplication(input) {
	${
		input.realtime
			? `if (!(input.realtime?.hmacKey instanceof Uint8Array) || input.realtime.hmacKey.byteLength < 32)
		throw new TypeError("resume-token HMAC key must contain at least 32 bytes");`
			: ""
	}
	const runtimeModule = await import("questpie:runtime-core");
	${input.realtime ? 'const realtimeModule = await import("questpie:runtime-realtime");' : ""}
	const {
		createDurableJobContext,
		createDurableReactionContext,
		createDurableWorker,
		createJobAcceptance,
		createPostgresJobAcceptanceTransaction,
		${postgresRuntimeTemplates.renderPostgresRuntimeImports()},
		createRuntimeApplication,
		executeCollectionOperationAdapter,
		createRuntimeActionExecutor,
		createRuntimeRouteExecutor,
		durablePrincipal,
		failRuntimeApplicationStartup,
		linkPostgresContextBootstrapPlans,
		linkPostgresMutationTransactionStatements,
		linkPostgresQueryPlans,
		OperationFailure,
	} = runtimeModule;
	const loaded = await loadRuntimeArtifacts();
	if (loaded.artifacts.runtimeBuild.postgresContextBootstrapPlansDigest !== expectedContextBootstrapPlansDigest)
		throw new TypeError("generated ContextBootstrap plans do not match Runtime Build");
	if (loaded.artifacts.runtimeBuild.postgresMutationTransactionStatementsDigest !== expectedMutationTransactionStatementsDigest)
		throw new TypeError("generated Mutation transaction statements do not match Runtime Build");
	if (loaded.artifacts.runtimeBuild.postgresCollectionOperationPlansDigest !== expectedCollectionOperationPlansDigest)
		throw new TypeError("generated Collection operation plans do not match Runtime Build");
	${postgresRuntimeTemplates.renderPostgresRuntimeOwnership()}
	const postgresController = new AbortController();
	const committedMigrations = JSON.parse(loaded.artifactFiles["committed-migrations.json"]);
	let queryPlans;
	const contextBootstrapPlans = linkPostgresContextBootstrapPlans({
		artifact: loaded.artifactFiles["postgres-context-bootstrap-plans.json"],
		schemaProjection,
		expectedDigest: expectedContextBootstrapPlansDigest,
	});
	const bootstrapFactory = createLinkedPostgresContextBootstrapFactory({
		database,
		plans: contextBootstrapPlans,
		collections: [${collectionDefinitions}],
	});
	let liveQueryCoordinator;
	let mutationArtifacts;
	let runtime;
	let routeExecutor;
	let createDirectActions;
	let createDirectJobs;
	const resolveApplicationPrincipal = async (request) => {
		${
			credentialResolverDefinition
				? `const service = await runtime.applicationService(${credentialResolverDefinition}.service);
		const outcome = await ${credentialResolverDefinition}.resolve({ request, service });
		if (outcome.kind === "unavailable")
			throw new OperationFailure("CREDENTIALS_UNAVAILABLE", true);
		if (outcome.kind === "anonymous") return principal.anonymous();
		return outcome.principal;`
				: "return principal.anonymous();"
		}
	};
	try {
		liveQueryCoordinator = ${
			input.realtime
				? `realtimeModule.createPostgresLiveQueryCoordinator({
		program: linkLiveQueryArtifacts(realtimeModule, loaded.artifactFiles),
		postgres: postgresRuntime,
		hmacKey: input.realtime.hmacKey,
		applicationName: ${JSON.stringify(input.configuration.application.name)},
		deploymentDigest: loaded.artifacts.runtimeBuild.digest,
		wireVersion: JSON.parse(loaded.artifactFiles["realtime-wire-contract.json"]).version,
		signal: postgresController.signal,
	})`
				: "undefined"
		};
		runtime = await createRuntimeApplication({
		artifacts: loaded.artifacts,
		artifactFiles: loaded.artifactFiles,
		serverExports,
		bindings: {
			application: ${JSON.stringify(`application:${input.configuration.application.name}`)},
			runtimeBuildDigest: loaded.artifacts.runtimeBuild.digest,
			slots: slotBindings,
		},
		program: {
			services: [${serviceDefinitions.join(", ")}],
			context: ${contextDefinition},
			bootstrap: bootstrapFactory,
			resolvePrincipal: resolveApplicationPrincipal,
			liveQueryCoordinator,
			${input.realtime ? "createRealtime: realtimeModule.createRuntimeRealtime," : ""}
			verifyReadiness: (artifacts) => {
				const mutationTransactionStatements = linkPostgresMutationTransactionStatements({
					artifact: loaded.artifactFiles["postgres-mutation-transaction-statements.json"],
					expectedDigest: expectedMutationTransactionStatementsDigest,
				});
				mutationArtifacts = Object.freeze({
					...linkMutationArtifacts(runtimeModule, loaded.artifactFiles, loaded.artifacts.runtimeBuild.compilerRuntimeBuildDigest),
					transactionStatements: mutationTransactionStatements,
				});
				${generatedOperations.linkHandlers}
				const queryPlanBytes = loaded.artifactFiles["postgres-query-plans.json"];
				if (queryPlanBytes !== undefined)
					queryPlans = linkPostgresQueryPlans(queryPlanBytes, expectedQueryDigests);
				else if (structuralQueryDigests.size !== 0)
					throw new TypeError("PostgreSQL Query plans are unavailable");
				return verifyPostgresDatabaseRuntimeReadiness({
					database,
					runtime: {
						definePostgresStatement,
						verifyReadinessPrerequisites: verifyPostgresDatabaseReadinessPrerequisitesInOwnedTransaction,
					},
					schema: schemaProjection,
					committedMigrations,
					expected: artifacts.runtimeBuild,
				});
			},
			project: ({ facts }) => Object.freeze({
				data: Object.freeze({
					run: (definition, operationInput) => {
						const queryDigest = structuralQueryDigests.get(definition);
						const linkedPlan = queryDigest && queryPlans?.get(queryDigest);
						if (!linkedPlan) throw new TypeError("Structural Query is not in the Runtime Build");
						return executePostgresDatabaseQuery({
							linkedPlan,
							binding: {
								templateDigest: linkedPlan.plan.templateDigest,
								values: linkedPlan.plan.binding.parameters.map(({ name }) => ({ parameter: name, value: operationInput[name] })),
							},
							executionFacts: {
								authority: facts.authority,
								principal: { id: facts.principal.id, kind: facts.principal.kind },
								tenant: { id: facts.tenant.id },
							},
							database,
							signal: facts.signal,
							observer: facts.liveQueryObservation ?? undefined,
						});
					},
				}),
				signal: facts.signal,
			}),
			projectMutation: ({ facts }) => {
				if (!mutationArtifacts)
					throw new TypeError("Mutation artifacts are not linked");
				return createPostgresDatabaseMutationInvoker({
					database,
					application: ${JSON.stringify(`application:${input.configuration.application.name}`)},
					transactionStatements: mutationArtifacts.transactionStatements,
					facts,
					collectionPlans: mutationArtifacts.collectionPlans,
					collectionOperations: mutationArtifacts.collectionOperations,
					queryPlans,
					reactions: mutationArtifacts.reactions,
					jobs: mutationArtifacts.jobs,
					contextInputCodec: ${contextDefinition}.input,
					runtimeBuildDigest: loaded.artifacts.runtimeBuild.digest,
				});
			},
			invokeAction: ({ identity, input: actionInput, effectKey, callId, timeoutMilliseconds, execution, operations }) => {
				switch (identity) {
					${networkActionCases}
					default: throw new OperationFailure("NOT_FOUND");
				}
			},
			projectExecution: async (scope) => Object.freeze({
				actionScope: scope,
				principal: scope.facts.principal,
				authority: scope.facts.authority,
				tenant: scope.facts.tenant,
				values: scope.facts.values,
				services: Object.freeze({${renderExecutionServiceEntries("scope.service")}}),
				signal: scope.facts.signal,
				deadline: scope.facts.deadline,
			}),
		},
		});
		const actionContracts = new Map(loaded.artifacts.operationContracts.operations
			.filter((contract) => contract.identity.startsWith("action:"))
			.map((contract) => [contract.identity, contract]));
		createDirectActions = (scope, operations) => {
			const actions = createRuntimeActionExecutor({
				application: ${JSON.stringify(`application:${input.configuration.application.name}`)},
				bindings: Object.freeze([${actionBindings}]),
				project: async ({ facts, service }) => Object.freeze({
				principal: facts.principal,
				authority: facts.authority,
				tenant: facts.tenant,
				values: facts.values,
				services: Object.freeze({${actionServiceEntries}}),
				signal: facts.signal,
				deadline: facts.deadline,
				queries: ${directQueries},
				mutations: ${directMutations},
			}),
			});
			return ${directActions};
		};
		${renderDirectJobAcceptance({ application: `application:${input.configuration.application.name}`, contextDefinition, directJobOperations: directJobs })}
		routeExecutor = createRuntimeRouteExecutor({
			runtime,
			bindings: [${routeBindings}],
			${credentialResolverDefinition ? `credentials: { service: ${credentialResolverDefinition}.service, resolve: ${credentialResolverDefinition}.resolve },` : ""}
			project: async ({ principal, service, signal, execution }) => Object.freeze({
				principal,
				services: Object.freeze({${routeServiceEntries}}),
				signal,
				execution: (root, use) => execution(root, ({ execution: { actionScope, ...facts }, ...operations }) => use(Object.freeze({
					...facts,
					queries: ${directQueries},
					mutations: ${directMutations},
					actions: createDirectActions(actionScope, operations),
					jobs: createDirectJobs(facts, root.context),
				}))),
			}),
		});
	} catch (error) {
		return failRuntimeApplicationStartup({
			error,
			runtime,
			abort: () => postgresController.abort(new DOMException("Runtime startup failed", "AbortError")),
			closePostgres: (deadlineAt) => postgresRuntime.close({ deadlineAt }),
		});
	}
	${renderDurableWorkerOwner({ application: `application:${input.configuration.application.name}`, directQueries, directMutations })}
	let defaultWorker;
	const durable = Object.freeze({
		worker: createWorker,
		poll: (options) => {
			// An option-bearing poll is its own worker; it must not rebind the
			// default one for later callers.
			if (options) return createWorker(options).poll();
			defaultWorker ??= createWorker();
			return defaultWorker.poll();
		},
		inspect: (runId) => durableKernel.inspect(runId),
		events: (runId) => durableKernel.events(runId),
		effects: (runId) => durableLedger.read(runId),
		audit: (runId) => durableMaintenance.audit(runId),
		cancelRun: (request) => durableMaintenance.cancelRun(request),
		retryRun: (request) => durableMaintenance.retryRun(request),
		acknowledgeAmbiguity: (request) => durableMaintenance.acknowledgeAmbiguity(request),
	});
	let closePromise;
	return Object.freeze({
		${postgresRuntimeTemplates.renderPostgresRuntimeFacts()}
		fetch: async (request) => (await routeExecutor.fetch(request)) ?? runtime.fetch(request),
		execution: (root, use) => runtime.execution(root, ({ execution: { actionScope, ...execution }, ...operations }) => use(Object.freeze({
			...execution,
			queries: ${directQueries},
			mutations: ${directMutations},
			actions: createDirectActions(actionScope, operations),
			jobs: createDirectJobs(execution, root.context),
		}))),
		durable,
		routes: Object.freeze({${directRouteEntries}}),
		close: () => {
			if (!closePromise) {
				const deadlineAt = Date.now() + 30_000;
				for (const worker of durableWorkers) worker.beginDrain();
				closePromise = runtime.close({ deadlineAt }).finally(() => {
					postgresController.abort(new DOMException("Runtime closed", "AbortError"));
					return postgresRuntime.close({ deadlineAt });
				});
			}
			return closePromise;
		},
	});
}
`;
}

export async function renderApplicationBundle(
	input: Readonly<{
		applicationRoot: string;
		configuration: ApplicationConfiguration;
		resources: readonly NormalizedResource[];
		slots: readonly RuntimeExecutableSlot[];
		inventories: readonly PackageInventory[];
		queryProjection: unknown;
		schemaProjection: unknown;
		contextBootstrapPlansDigest: string;
		mutationTransactionStatementsDigest: string;
		collectionOperationPlansDigest: string;
		collectionLifecycleProgramsDigest: string | null;
		collectionOperationArtifacts: boolean;
		collectionLifecycleArtifacts: boolean;
		collectionOperationAdapterArtifacts: boolean;
		reactionArtifact: boolean;
		jobArtifact: boolean;
		realtime: boolean;
		readinessEntry: string;
		runtimeCoreBundleEntry: string;
		runtimeRealtimeBundleEntry: string;
	}>,
): Promise<Readonly<Record<string, string>>> {
	return bundleApplicationEntry({ ...input, entry: applicationEntry(input) });
}

export function renderApplicationDeclaration(): string {
	return `import type { Principal } from "questpie";
import type { CreateAppInput, GeneratedApp } from "../app";

export declare function createApplication(input: CreateAppInput): Promise<GeneratedApp>;
export declare function bindIngressPrincipalForRequest(request: Request, principal: Principal): Request;
`;
}
