import { resolve } from "node:path";

import { compareAscii } from "../canonical";
import type {
	ApplicationConfiguration,
	NormalizedResource,
	PackageInventory,
} from "../types";

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
		postgresQueryPlans: unknown;
		schemaProjection: unknown;
		collectionOperationArtifacts: boolean;
		reactionArtifact: boolean;
	}>,
): string {
	const definitions = new Map<string, number>();
	const imports: string[] = [];
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
	const bindingEntries = input.slots.map((slot) => {
		const definition = definitionName(slot);
		const operation = slot.kind === "query" || slot.kind === "mutation";
		const implementation = operation
			? `${definition}.handler`
			: `${definition}.${slot.slot}`;
		return `Object.freeze({ identity: ${JSON.stringify(slot.identity)}, kind: ${JSON.stringify(slot.kind)}, slot: ${JSON.stringify(slot.slot)}, runtimeGraphDigest: ${JSON.stringify(slot.runtimeGraphDigest)}, bundleExport: ${JSON.stringify(slot.bundleExport)}, definition: ${definition}${operation ? `, execute: ${implementation}` : ""} })`;
	});
	const serverEntries = input.slots.map((slot) => {
		const definition = definitionName(slot);
		const implementation =
			slot.kind === "query" || slot.kind === "mutation"
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
	const applicationServiceEntries = input.resources
		.filter(
			(resource) =>
				resource.kind === "service" && resource.origin.packageId === null,
		)
		.sort((left, right) => compareAscii(left.name, right.name))
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
			return `${JSON.stringify(resource.name)}: await service(${definitionName(slot)})`;
		})
		.join(",\n");
	const queries = input.resources
		.filter((resource) => resource.kind === "query")
		.sort((left, right) => compareAscii(left.name, right.name));
	const directQueries = queries
		.map(
			(resource) =>
				`${JSON.stringify(resource.name)}: (operationInput) => operations.invoke(${JSON.stringify(resource.identity)}, operationInput)`,
		)
		.join(",\n");
	const mutations = input.resources
		.filter((resource) => resource.kind === "mutation")
		.sort((left, right) => compareAscii(left.name, right.name));
	const directMutations = mutations
		.map(
			(resource) =>
				`${JSON.stringify(resource.name)}: (operationInput, options) => operations.invoke(${JSON.stringify(resource.identity)}, operationInput, options)`,
		)
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
				`[structuralQuery${index}, ${JSON.stringify(String(query.digest))}]`,
		)
		.join(",\n");
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
		plans: {
			format: "questpie.postgres-collection-operation-plans",
			version: 1,
			plans: [],
		},
		policies: [],
	});
	const emptyReactionProjection = JSON.stringify({
		format: "questpie.reaction-projection",
		version: 1,
		reactions: [],
	});
	return `import { SQL } from "bun";
import { createPostgresMutationInvoker, createRuntimeApplication, executePostgresQuery, linkCollectionMutationPrograms, linkPostgresCollectionOperationPlans, linkReactionProjection } from "questpie:runtime";
import { createPostgresContextBootstrap } from "questpie:runtime-bootstrap";
import { bindIngressPrincipal, readIngressPrincipal } from "questpie:runtime-ingress";
import { verifyPostgresRuntimeReadiness } from "questpie:runtime-readiness";
${imports.join("\n")}
${structuralImports.join("\n")}

const schemaProjection = ${JSON.stringify(input.schemaProjection)};
const postgresQueryPlans = ${JSON.stringify(input.postgresQueryPlans)};
const structuralQueryDigests = new Map([${structuralEntries}]);
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
			wireContract: JSON.parse(artifactFiles["wire-contract.json"]),
		},
		artifactFiles,
	};
}

function linkMutationArtifacts(artifactFiles) {
	const raw = ${
		input.collectionOperationArtifacts
			? `{
		programs: JSON.parse(artifactFiles["collection-operation-programs.json"]),
		normalizers: JSON.parse(artifactFiles["field-normalizer-programs.json"]),
		serverValues: JSON.parse(artifactFiles["server-value-programs.json"]),
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
		fieldNormalizers: raw.normalizers,
		serverValues: raw.serverValues,
		policies: raw.policies,
	});
	return Object.freeze({
		collectionPlans: linkPostgresCollectionOperationPlans({
			artifact: raw.plans,
			operations,
		}),
		reactions: linkReactionProjection(${input.reactionArtifact ? `JSON.parse(artifactFiles["reaction-projection.json"])` : emptyReactionProjection}),
	});
}

export const bindIngressPrincipalForRequest = bindIngressPrincipal;

export async function createApplication(input) {
	const sql = new SQL(input.postgres.url);
	const postgresController = new AbortController();
	const loaded = await loadRuntimeArtifacts();
	const committedMigrations = JSON.parse(loaded.artifactFiles["committed-migrations.json"]);
	const plansByDigest = new Map(postgresQueryPlans.plans.map((plan) => [plan.queryDigest, plan]));
	const bootstrap = createPostgresContextBootstrap({
		sql,
		schema: schemaProjection,
		signal: postgresController.signal,
	});
	let mutationArtifacts;
	let runtime;
	try {
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
			bootstrap,
			resolvePrincipal: readIngressPrincipal,
			verifyReadiness: (artifacts) => {
				mutationArtifacts = linkMutationArtifacts(loaded.artifactFiles);
				return verifyPostgresRuntimeReadiness({
					sql,
					schema: schemaProjection,
					committedMigrations,
					expected: artifacts.runtimeBuild,
				});
			},
			project: ({ facts }) => Object.freeze({
				data: Object.freeze({
					run: (definition, operationInput) => {
						const queryDigest = structuralQueryDigests.get(definition);
						const plan = queryDigest && plansByDigest.get(queryDigest);
						if (!plan) throw new TypeError("Structural Query is not in the Runtime Build");
						return executePostgresQuery({
							plan,
							binding: {
								templateDigest: plan.templateDigest,
								values: plan.binding.parameters.map(({ name }) => ({ parameter: name, value: operationInput[name] })),
							},
							executionFacts: {
								authority: facts.authority,
								principal: { id: facts.principal.id },
								tenant: { id: facts.tenant.id },
							},
							sql,
							signal: facts.signal,
						});
					},
				}),
				signal: facts.signal,
			}),
			projectMutation: ({ facts }) => {
				if (!mutationArtifacts)
					throw new TypeError("Mutation artifacts are not linked");
				return createPostgresMutationInvoker({
					sql,
					application: ${JSON.stringify(`application:${input.configuration.application.name}`)},
					facts,
					collectionPlans: mutationArtifacts.collectionPlans,
					reactions: mutationArtifacts.reactions,
				});
			},
			projectExecution: async ({ facts, service }) => Object.freeze({
				principal: facts.principal,
				authority: facts.authority,
				tenant: facts.tenant,
				values: facts.values,
				services: Object.freeze({${applicationServiceEntries}}),
				signal: facts.signal,
				deadline: facts.deadline,
			}),
		},
		});
	} catch (error) {
		postgresController.abort(new DOMException("Runtime startup failed", "AbortError"));
		await sql.close();
		throw error;
	}
	let closePromise;
	return Object.freeze({
		fetch: runtime.fetch,
		execution: (root, use) => runtime.execution(root, ({ execution, ...operations }) => use(Object.freeze({
			...execution,
			queries: Object.freeze({${directQueries}}),
			mutations: Object.freeze({${directMutations}}),
		}))),
		close: () => {
			if (!closePromise) closePromise = runtime.close().finally(() => {
				postgresController.abort(new DOMException("Runtime closed", "AbortError"));
				return sql.close();
			});
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
		postgresQueryPlans: unknown;
		schemaProjection: unknown;
		collectionOperationArtifacts: boolean;
		reactionArtifact: boolean;
		readinessEntry: string;
		runtimeBundleEntry: string;
	}>,
): Promise<string> {
	const entry = applicationEntry(input);
	const packageEntries = new Map(
		input.inventories.map((inventory) => [
			`${inventory.package.name}/questpie`,
			inventory.package.entry,
		]),
	);
	const result = await Bun.build({
		entrypoints: ["questpie:application-entry"],
		target: "bun",
		format: "esm",
		minify: { whitespace: true },
		sourcemap: "none",
		packages: "bundle",
		external: ["questpie"],
		plugins: [
			{
				name: "questpie-application-bundle",
				setup(builder) {
					builder.onResolve({ filter: /^questpie:application-entry$/ }, () => ({
						path: "application-entry",
						namespace: "questpie-entry",
					}));
					builder.onLoad({ filter: /.*/, namespace: "questpie-entry" }, () => ({
						contents: entry,
						loader: "ts",
					}));
					builder.onResolve({ filter: /^#questpie\/app$/ }, () => ({
						path: "authoring-app",
						namespace: "questpie-authoring",
					}));
					builder.onResolve({ filter: /^#questpie\/package$/ }, () => ({
						path: "authoring-package",
						namespace: "questpie-authoring",
					}));
					builder.onLoad(
						{ filter: /.*/, namespace: "questpie-authoring" },
						() => ({
							contents:
								'const define = (kind) => (definition) => Object.freeze({ ...definition, kind, identity: `${kind}:${definition.name}`, network: definition.network === true }); export const defineQuery = define("query"); export const defineMutation = define("mutation");',
							loader: "js",
						}),
					);
					builder.onResolve({ filter: /^#questpie\/source\// }, (args) => ({
						path: resolve(
							input.applicationRoot,
							input.configuration.source.root,
							args.path.slice("#questpie/source/".length),
						),
					}));
					builder.onResolve({ filter: /^questpie:runtime$/ }, () => ({
						path: input.runtimeBundleEntry,
					}));
					builder.onResolve({ filter: /^questpie:runtime-readiness$/ }, () => ({
						path: input.readinessEntry,
					}));
					builder.onResolve({ filter: /^questpie:runtime-bootstrap$/ }, () => ({
						path: input.runtimeBundleEntry,
					}));
					builder.onResolve({ filter: /^questpie:runtime-ingress$/ }, () => ({
						path: input.runtimeBundleEntry,
					}));
					builder.onResolve({ filter: /.*/ }, (args) => {
						const packageEntry = packageEntries.get(args.path);
						return packageEntry ? { path: packageEntry } : undefined;
					});
				},
			},
		],
	});
	if (!result.success)
		throw new TypeError(
			`Runtime Application bundle failed: ${result.logs.map((log) => log.message).join("; ")}`,
		);
	const output = result.outputs.find((item) => item.kind === "entry-point");
	if (!output)
		throw new TypeError("Runtime Application bundle emitted no entry");
	return output.text();
}

export function renderApplicationDeclaration(): string {
	return `import type { Principal } from "questpie";
import type { CreateAppInput, GeneratedApp } from "../app";

export declare function createApplication(input: CreateAppInput): Promise<GeneratedApp>;
export declare function bindIngressPrincipalForRequest(request: Request, principal: Principal): Request;
`;
}
