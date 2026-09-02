import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { codec, defineContext, defineService, principal } from "questpie";
import { createOfficialQuestpieObservability } from "questpie/internal/observability";

import { projectObservationSignalProjection } from "../../packages/compiler/src/observation";
import {
	createRuntimeApplication,
	type ExecutionEventV2,
} from "../../packages/runtime/src";
import {
	createRuntimeActionExecutor,
	type RuntimeActionBinding,
} from "../../packages/runtime/src/action";
import { createApplicationObservation } from "../../packages/runtime/src/application/observation";
import { runObservedDurableAttempt } from "../../packages/runtime/src/durable";
import type { LiveQueryObservation } from "../../packages/runtime/src/live-query";
import type { ObservationAdapterV1 } from "../../packages/runtime/src/observation";
import {
	bindIngressPrincipal,
	readIngressPrincipal,
} from "../../packages/runtime/src/operation/ingress";

const sha = (character: string) => character.repeat(64);

const createObservationHandle = (adapter: ObservationAdapterV1) =>
	createOfficialQuestpieObservability(() => adapter);

function canonical(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	const source = value as Readonly<Record<string, unknown>>;
	return `{${Object.keys(source)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonical(source[key])}`)
		.join(",")}}`;
}

function digest(domain: string, value: unknown): string {
	return createHash("sha256")
		.update(`${domain}\0${canonical(value)}\n`)
		.digest("hex");
}

function fileDigest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function runtimeArtifacts(
	additionalSlots: readonly unknown[] = [],
	actionContractIdentities?: readonly string[],
) {
	const observationSignalProjection =
		projectObservationSignalProjection("4.0.0-beta.1");
	const runtimeExecutables = {
		format: "questpie.runtime-executables",
		version: 1,
		slots: [
			{
				identity: "context:app.context",
				kind: "context",
				slot: "resolve",
				origin: {
					path: "src/context.ts",
					exportName: "appContext",
					packageId: null,
				},
				sourceDigest: sha("1"),
				contractDigest: sha("2"),
				runtimeGraphDigest: sha("3"),
				bundleExport: "context_app_context_resolve",
			},
			{
				identity: "query:messages.page",
				kind: "query",
				slot: "handler",
				origin: {
					path: "src/messages-page.ts",
					exportName: "messagesPage",
					packageId: null,
				},
				sourceDigest: sha("4"),
				contractDigest: sha("5"),
				runtimeGraphDigest: sha("6"),
				bundleExport: "query_messages_page_handler",
			},
			...additionalSlots,
		].sort((left, right) => {
			const leftSlot = left as Readonly<{ identity: string; slot: string }>;
			const rightSlot = right as Readonly<{ identity: string; slot: string }>;
			const leftKey = `${leftSlot.identity}#${leftSlot.slot}`;
			const rightKey = `${rightSlot.identity}#${rightSlot.slot}`;
			return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
		}),
	};
	const mutationOperations = additionalSlots.flatMap((raw) => {
		const slot = raw as Readonly<{ identity?: unknown; kind?: unknown }>;
		return slot.kind === "mutation" && typeof slot.identity === "string"
			? [
					{
						identity: slot.identity,
						input: { kind: "text" as const },
						output: { kind: "text" as const },
						declaredErrors: {},
					},
				]
			: [];
	});
	const inferredActionIdentities = additionalSlots.flatMap((raw) => {
		const slot = raw as Readonly<{ identity?: unknown; kind?: unknown }>;
		return slot.kind === "action" && typeof slot.identity === "string"
			? [slot.identity]
			: [];
	});
	const actionOperations = (
		actionContractIdentities ?? inferredActionIdentities
	).map((identity) => ({
		identity,
		input: {
			kind: "object" as const,
			properties: { message: { kind: "text" as const } },
		},
		output: {
			kind: "object" as const,
			properties: { receipt: { kind: "text" as const } },
		},
		declaredErrors: {},
	}));
	const unsignedHttp = {
		format: "questpie.operation-http",
		version: 1,
		application: "application:collaboration",
		operations: [
			...actionOperations,
			...mutationOperations,
			{
				identity: "query:messages.page",
				input: {
					kind: "object",
					properties: {
						at: { kind: "optional", codec: { kind: "timestamp" } },
						first: { kind: "integer" },
					},
				},
				output: { kind: "object", properties: { count: { kind: "integer" } } },
				declaredErrors: {},
			},
		].sort((left, right) =>
			left.identity < right.identity
				? -1
				: left.identity > right.identity
					? 1
					: 0,
		),
		failures: [
			"COMMITTED_RESULT_UNAVAILABLE",
			"DEADLINE_EXCEEDED",
			"INTERNAL",
			"NOT_FOUND",
			"PROTOCOL_UNSUPPORTED",
			"RESOURCE_LIMIT",
			"RUNTIME_UNAVAILABLE",
			"UNAUTHENTICATED",
		],
		limits: { requestBytes: 1_048_576, responseBytes: 1_048_576 },
		principalSource: "ingressOutsideBody",
		mutationAutomaticRetry: false,
		clientContractDigest: sha("7"),
	} as const;
	const httpContract = {
		...unsignedHttp,
		digest: digest("questpie-operation-http-v1", unsignedHttp),
	};
	const actionContracts = actionOperations.map((operation) => ({
		...operation,
		admission: "authenticated",
		limits: {
			inputBytes: 1_024,
			resultBytes: 1_024,
			durationMilliseconds: 1_000,
		},
	}));
	const operationContracts = {
		format: "questpie.operation-contracts",
		version: 1,
		operations: [
			...actionContracts,
			...unsignedHttp.operations
				.filter((operation) => !operation.identity.startsWith("action:"))
				.map((operation) =>
					operation.identity.startsWith("mutation:")
						? { ...operation, admission: "authenticated" as const }
						: operation,
				),
		].sort((left, right) =>
			left.identity < right.identity
				? -1
				: left.identity > right.identity
					? 1
					: 0,
		),
	};
	const unsignedContextBootstrapPlans = {
		format: "questpie.postgres-context-bootstrap-plans",
		version: 1,
		plans: [],
	};
	const contextBootstrapPlans = {
		...unsignedContextBootstrapPlans,
		digest: digest(
			"questpie-postgres-context-bootstrap-plans-v1",
			unsignedContextBootstrapPlans,
		),
	};
	const unsignedMutationTransactionStatements = {
		format: "questpie.postgres-mutation-transaction-statements",
		version: 1,
		statements: [],
	};
	const mutationTransactionStatements = {
		...unsignedMutationTransactionStatements,
		digest: digest(
			"questpie-postgres-mutation-transaction-statements-v1",
			unsignedMutationTransactionStatements,
		),
	};
	const unsignedCollectionOperationPlans = {
		format: "questpie.postgres-collection-operation-plans",
		version: 1,
		plans: [],
	};
	const collectionOperationPlansDigest = digest(
		"questpie-postgres-collection-operation-plans-v1",
		unsignedCollectionOperationPlans,
	);
	const artifactFiles = {
		"app.ts": "export type App = unknown;\n",
		"build-input.json": '{"format":"questpie.build-input"}\n',
		"committed-migrations.json": "[]\n",
		"internal/application.js": "export const runtime = true;\n",
		"internal/package-inventories.json": "[]\n",
		"internal/server.ts": "export const executable = true;\n",
		"manifest.json": '{"format":"questpie.manifest"}\n',
		"opentelemetry-signal-projection.json": observationSignalProjection.bytes,
		"operation-contracts.json": `${JSON.stringify(operationContracts)}\n`,
		"policy-projection.json": "{}\n",
		"postgres-context-bootstrap-plans.json": `${JSON.stringify(contextBootstrapPlans)}\n`,
		"postgres-mutation-transaction-statements.json": `${JSON.stringify(mutationTransactionStatements)}\n`,
		"postgres-query-plans.json": "{}\n",
		"query-projection.json": "{}\n",
		"runtime-executables.json": `${JSON.stringify(runtimeExecutables)}\n`,
		"schema-projection.json": "{}\n",
		"operation-http-contract.json": `${JSON.stringify(httpContract)}\n`,
	};
	const compiler = {
		version: "4.0.0-beta.1",
		bunVersion: Bun.version,
		buildInputDigest: fileDigest(artifactFiles["build-input.json"]),
		executableFormat: "source-module-v1",
	};
	const slots = runtimeExecutables.slots.map(
		({ identity, kind, slot, runtimeGraphDigest, bundleExport }) => ({
			identity,
			kind,
			slot,
			runtimeGraphDigest,
			bundleExport,
		}),
	);
	const runtimeGraphDigest = digest(
		"questpie-runtime-graphs-v1",
		slots.map(({ identity, slot, runtimeGraphDigest: graph }) => ({
			identity,
			slot,
			runtimeGraphDigest: graph,
		})),
	);
	const runtimeBuildWithoutDigest = {
		format: "questpie.runtime-build",
		version: 1,
		application: "application:collaboration",
		runtimeAbi: "questpie.runtime.v1",
		internalProtocol: "questpie.internal.v2",
		compiler,
		compilerRuntimeBuildDigest: digest(
			"questpie-compiler-runtime-build-v1",
			compiler,
		),
		manifestDigest: fileDigest(artifactFiles["manifest.json"]),
		appContractDigest: fileDigest(artifactFiles["app.ts"]),
		clientContractDigest: unsignedHttp.clientContractDigest,
		packageInventoryDigest: fileDigest(
			artifactFiles["internal/package-inventories.json"],
		),
		schemaProjectionDigest: fileDigest(artifactFiles["schema-projection.json"]),
		policyProjectionDigest: fileDigest(artifactFiles["policy-projection.json"]),
		queryProjectionDigest: fileDigest(artifactFiles["query-projection.json"]),
		postgresQueryPlansDigest: fileDigest(
			artifactFiles["postgres-query-plans.json"],
		),
		postgresContextBootstrapPlansDigest: contextBootstrapPlans.digest,
		postgresMutationTransactionStatementsDigest:
			mutationTransactionStatements.digest,
		postgresCollectionOperationPlansDigest: collectionOperationPlansDigest,
		observationSignalProjectionDigest: observationSignalProjection.digest,
		committedMigrationsDigest: fileDigest(
			artifactFiles["committed-migrations.json"],
		),
		migrationHead: "000002_authorize-message-pages",
		schemaFingerprint: sha("8"),
		serverBundleDigest: fileDigest(artifactFiles["internal/application.js"]),
		runtimeExecutablesDigest: digest(
			"questpie-runtime-executables-v1",
			runtimeExecutables,
		),
		operationContractsDigest: digest(
			"questpie-operation-contracts-v1",
			operationContracts,
		),
		runtimeGraphDigest,
		operationHttpContractDigest: httpContract.digest,
		executableSlots: slots.map((slot) => `${slot.identity}#${slot.slot}`),
		slots,
		later: {
			changeLedgerDigest: null,
			resumeDigest: null,
			durableCompatibilityDigest: null,
			reactionDigest: null,
		},
		inventory: Object.entries(artifactFiles)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([path, bytes]) => ({
				path,
				digest: fileDigest(bytes),
			})),
	};
	return {
		artifactFiles,
		runtimeExecutables,
		operationContracts,
		httpContract,
		runtimeBuild: {
			...runtimeBuildWithoutDigest,
			digest: digest("questpie-runtime-build-v1", runtimeBuildWithoutDigest),
		},
	};
}

function runtimeArtifactEnvelope(value: ReturnType<typeof runtimeArtifacts>) {
	return {
		runtimeBuild: value.runtimeBuild,
		runtimeExecutables: value.runtimeExecutables,
		operationContracts: value.operationContracts,
		httpContract: value.httpContract,
	};
}
function queryExecutable<View>(
	execute: (
		input: Readonly<{ input: unknown; ctx: View }>,
	) => unknown | Promise<unknown>,
	runtimeGraphDigest = sha("6"),
) {
	return {
		identity: "query:messages.page",
		kind: "query" as const,
		slot: "handler" as const,
		runtimeGraphDigest,
		bundleExport: "query_messages_page_handler",
		execute,
		definition: { name: "messages.page", handler: execute },
	};
}

function serverExportsFor(bindings: readonly unknown[]) {
	return Object.fromEntries(
		bindings.map((raw) => {
			const binding = raw as Readonly<{
				bundleExport: string;
				kind: "context" | "mutation" | "query" | "service";
				slot: "create" | "dispose" | "handler" | "resolve";
				execute?: unknown;
				definition: Readonly<Record<string, unknown>>;
			}>;
			const implementation =
				binding.kind === "query" || binding.kind === "mutation"
					? binding.execute
					: binding.kind === "context"
						? binding.definition.resolve
						: binding.definition[binding.slot];
			return [binding.bundleExport, implementation];
		}),
	);
}

function executableBindings(
	artifacts: ReturnType<typeof runtimeArtifacts>,
	slots: readonly unknown[],
) {
	return {
		bindings: {
			application: "application:collaboration",
			runtimeBuildDigest: artifacts.runtimeBuild.digest,
			slots: slots as never,
		},
		serverExports: serverExportsFor(slots),
	};
}

test("requires the Runtime Build to bind the Schema Fingerprint", async () => {
	const context = defineContext({
		name: "app.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const artifacts = runtimeArtifacts();
	const {
		schemaFingerprint: _schemaFingerprint,
		digest: _runtimeBuildDigest,
		...runtimeBuildWithoutSchemaFingerprint
	} = artifacts.runtimeBuild;
	const runtimeBuild = {
		...runtimeBuildWithoutSchemaFingerprint,
		digest: digest(
			"questpie-runtime-build-v1",
			runtimeBuildWithoutSchemaFingerprint,
		),
	};
	const bindings = [
		{
			identity: "context:app.context",
			kind: "context" as const,
			slot: "resolve" as const,
			runtimeGraphDigest: sha("3"),
			bundleExport: "context_app_context_resolve",
			definition: context,
		},
		queryExecutable(() => ({ count: 1 })),
	];
	await expect(
		createRuntimeApplication({
			artifacts: {
				...runtimeArtifactEnvelope(artifacts),
				runtimeBuild,
			},
			artifactFiles: artifacts.artifactFiles,
			...executableBindings(
				{ ...artifacts, runtimeBuild: runtimeBuild as never },
				bindings,
			),
			program: {
				services: [],
				context,
				bootstrap: () => ({ get: async () => null }),
				project: ({ facts }) => ({ signal: facts.signal }),
				resolvePrincipal: async () => principal.anonymous(),
			},
		}),
	).rejects.toThrow("runtime build has invalid keys");
});

test("rejects an unsupported Runtime ABI or internal protocol before readiness", async () => {
	let readinessChecks = 0;
	const context = defineContext({
		name: "app.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const artifacts = runtimeArtifacts();
	const bindings = [
		{
			identity: "context:app.context",
			kind: "context" as const,
			slot: "resolve" as const,
			runtimeGraphDigest: sha("3"),
			bundleExport: "context_app_context_resolve",
			definition: context,
		},
		queryExecutable(() => ({ count: 1 })),
	];
	for (const [field, value, message] of [
		["runtimeAbi", "questpie.runtime.v999", "unsupported Runtime ABI"],
		[
			"internalProtocol",
			"questpie.internal.v999",
			"unsupported internal protocol",
		],
	] as const) {
		const { digest: _digest, ...unsignedBuild } = artifacts.runtimeBuild;
		const changedBuild = { ...unsignedBuild, [field]: value };
		const runtimeBuild = {
			...changedBuild,
			digest: digest("questpie-runtime-build-v1", changedBuild),
		};
		await expect(
			createRuntimeApplication({
				artifacts: {
					...runtimeArtifactEnvelope(artifacts),
					runtimeBuild,
				},
				artifactFiles: artifacts.artifactFiles,
				...executableBindings(
					{ ...artifacts, runtimeBuild: runtimeBuild as never },
					bindings,
				),
				program: {
					services: [],
					context,
					bootstrap: () => ({ get: async () => null }),
					project: ({ facts }) => ({ signal: facts.signal }),
					resolvePrincipal: async () => principal.anonymous(),
					verifyReadiness: () => {
						readinessChecks += 1;
					},
				},
			}),
		).rejects.toThrow(message);
	}
	expect(readinessChecks).toBe(0);
});

test("binds Runtime Build Application Identity to the executable bundle", async () => {
	let readinessChecks = 0;
	const context = defineContext({
		name: "app.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const original = runtimeArtifacts();
	const { digest: _httpDigest, ...unsignedHttp } = original.httpContract;
	const changedUnsignedHttp = {
		...unsignedHttp,
		application: "application:forged",
	};
	const httpContract = {
		...changedUnsignedHttp,
		digest: digest("questpie-operation-http-v1", changedUnsignedHttp),
	};
	const httpBytes = `${JSON.stringify(httpContract)}\n`;
	const { digest: _buildDigest, ...unsignedBuild } = original.runtimeBuild;
	const changedUnsignedBuild = {
		...unsignedBuild,
		application: "application:forged",
		operationHttpContractDigest: httpContract.digest,
		inventory: unsignedBuild.inventory.map((item) =>
			item.path === "operation-http-contract.json"
				? { ...item, digest: fileDigest(httpBytes) }
				: item,
		),
	};
	const runtimeBuild = {
		...changedUnsignedBuild,
		digest: digest("questpie-runtime-build-v1", changedUnsignedBuild),
	};
	const artifacts = {
		...original,
		artifactFiles: {
			...original.artifactFiles,
			"operation-http-contract.json": httpBytes,
		},
		runtimeBuild,
		httpContract,
	};
	const bindings = [
		{
			identity: "context:app.context",
			kind: "context" as const,
			slot: "resolve" as const,
			runtimeGraphDigest: sha("3"),
			bundleExport: "context_app_context_resolve",
			definition: context,
		},
		queryExecutable(() => ({ count: 1 })),
	];
	await expect(
		createRuntimeApplication({
			artifacts: runtimeArtifactEnvelope(artifacts as never),
			artifactFiles: artifacts.artifactFiles,
			...executableBindings(artifacts as never, bindings),
			program: {
				services: [],
				context,
				bootstrap: () => ({ get: async () => null }),
				project: ({ facts }) => ({ signal: facts.signal }),
				resolvePrincipal: async () => principal.anonymous(),
				verifyReadiness: () => {
					readinessChecks += 1;
				},
			},
		}),
	).rejects.toThrow("Runtime executable Application Identity does not match");
	expect(readinessChecks).toBe(0);
});

test("rejects a mismatched Runtime Build before Context or handler disclosure", async () => {
	let resolves = 0;
	let handlerCalls = 0;
	const context = defineContext({
		name: "app.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => {
			resolves += 1;
			return { tenant: { id: input.companyId }, values: {} };
		},
	});
	const artifacts = runtimeArtifacts();
	const bindings = [
		{
			identity: "context:app.context",
			kind: "context" as const,
			slot: "resolve" as const,
			runtimeGraphDigest: sha("3"),
			bundleExport: "context_app_context_resolve",
			definition: context,
		},
		queryExecutable(() => {
			handlerCalls += 1;
			return { count: 1 };
		}, sha("0")),
	];
	await expect(
		createRuntimeApplication({
			artifacts: runtimeArtifactEnvelope(artifacts),
			artifactFiles: artifacts.artifactFiles,
			...executableBindings(artifacts, bindings),
			program: {
				services: [],
				context,
				bootstrap: () => ({ get: async () => null }),
				project: ({ facts }) => ({ signal: facts.signal }),
				resolvePrincipal: async () => principal.anonymous(),
			},
		}),
	).rejects.toThrow("executable binding does not match");
	expect({ handlerCalls, resolves }).toEqual({ handlerCalls: 0, resolves: 0 });
});

test("rejects a forged Mutation Service capability before readiness", async () => {
	const context = defineContext({
		name: "app.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const execute = async () => ({ ok: true });
	const mutationSlot = {
		identity: "mutation:messages.publish",
		kind: "mutation" as const,
		slot: "handler" as const,
		origin: {
			path: "src/message-publish.ts",
			exportName: "publishMessage",
			packageId: null,
		},
		sourceDigest: sha("9"),
		contractDigest: sha("a"),
		runtimeGraphDigest: sha("b"),
		bundleExport: "mutation_messages_publish_handler",
	};
	const artifacts = runtimeArtifacts([mutationSlot]);
	const bindings = [
		{
			identity: "context:app.context",
			kind: "context" as const,
			slot: "resolve" as const,
			runtimeGraphDigest: sha("3"),
			bundleExport: "context_app_context_resolve",
			definition: context,
		},
		queryExecutable(() => ({ count: 1 })),
		{
			identity: mutationSlot.identity,
			kind: mutationSlot.kind,
			slot: mutationSlot.slot,
			runtimeGraphDigest: mutationSlot.runtimeGraphDigest,
			bundleExport: mutationSlot.bundleExport,
			execute,
			definition: {
				name: "messages.publish",
				handler: execute,
				errors: {},
				services: { mail: { effect: "external" } },
			},
		},
	];

	await expect(
		createRuntimeApplication({
			artifacts: runtimeArtifactEnvelope(artifacts),
			artifactFiles: artifacts.artifactFiles,
			...executableBindings(artifacts, bindings),
			program: {
				services: [],
				context,
				bootstrap: () => ({ get: async () => null }),
				project: ({ facts }) => ({ signal: facts.signal }),
				resolvePrincipal: async () => principal.anonymous(),
			},
		}),
	).rejects.toThrow("Mutation executable binding exposes Services");
});

test("rejects a changed inventory file before readiness or executable disclosure", async () => {
	let readiness = 0;
	let resolves = 0;
	let handlerCalls = 0;
	const context = defineContext({
		name: "app.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => {
			resolves += 1;
			return { tenant: { id: input.companyId }, values: {} };
		},
	});
	const artifacts = runtimeArtifacts();
	const bindings = [
		{
			identity: "context:app.context",
			kind: "context" as const,
			slot: "resolve" as const,
			runtimeGraphDigest: sha("3"),
			bundleExport: "context_app_context_resolve",
			definition: context,
		},
		queryExecutable(() => {
			handlerCalls += 1;
			return { count: 1 };
		}),
	];
	const program = {
		services: [],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: ({ facts }: { facts: { signal: AbortSignal } }) => ({
			signal: facts.signal,
		}),
		resolvePrincipal: async () => principal.anonymous(),
		verifyReadiness: () => {
			readiness += 1;
		},
	};
	await expect(
		createRuntimeApplication({
			artifacts: runtimeArtifactEnvelope(artifacts),
			artifactFiles: {
				...artifacts.artifactFiles,
				"manifest.json": `${artifacts.artifactFiles["manifest.json"]} `,
			},
			...executableBindings(artifacts, bindings),
			program,
		}),
	).rejects.toThrow("manifest.json digest does not match");
	const forgedSignalProjection = {
		...JSON.parse(
			artifacts.artifactFiles["opentelemetry-signal-projection.json"],
		),
		unexpected: true,
	};
	const forgedSignalBytes = `${JSON.stringify(forgedSignalProjection)}\n`;
	const { digest: _signalBuildDigest, ...unsignedSignalBuild } =
		artifacts.runtimeBuild;
	const resignedSignalBuild = {
		...unsignedSignalBuild,
		observationSignalProjectionDigest: digest(
			"questpie-opentelemetry-projection-v1",
			forgedSignalProjection,
		),
		inventory: unsignedSignalBuild.inventory.map((item) =>
			item.path === "opentelemetry-signal-projection.json"
				? { ...item, digest: fileDigest(forgedSignalBytes) }
				: item,
		),
	};
	await expect(
		createRuntimeApplication({
			artifacts: {
				...runtimeArtifactEnvelope(artifacts),
				runtimeBuild: {
					...resignedSignalBuild,
					digest: digest("questpie-runtime-build-v1", resignedSignalBuild),
				},
			},
			artifactFiles: {
				...artifacts.artifactFiles,
				"opentelemetry-signal-projection.json": forgedSignalBytes,
			},
			...executableBindings(artifacts, bindings),
			program,
		}),
	).rejects.toThrow("opentelemetry-signal-projection.json has invalid keys");
	const currentSignalProjection = JSON.parse(
		artifacts.artifactFiles["opentelemetry-signal-projection.json"],
	);
	const forgedGrammarProjection = {
		...currentSignalProjection,
		httpTerminalGrammar: {
			...currentSignalProjection.httpTerminalGrammar,
			null: { outcomes: ["framework_error", "cancelled"] },
		},
	};
	const forgedGrammarBytes = `${JSON.stringify(forgedGrammarProjection)}\n`;
	const resignedGrammarBuild = {
		...unsignedSignalBuild,
		observationSignalProjectionDigest: digest(
			"questpie-opentelemetry-projection-v1",
			forgedGrammarProjection,
		),
		inventory: unsignedSignalBuild.inventory.map((item) =>
			item.path === "opentelemetry-signal-projection.json"
				? { ...item, digest: fileDigest(forgedGrammarBytes) }
				: item,
		),
	};
	await expect(
		createRuntimeApplication({
			artifacts: {
				...runtimeArtifactEnvelope(artifacts),
				runtimeBuild: {
					...resignedGrammarBuild,
					digest: digest("questpie-runtime-build-v1", resignedGrammarBuild),
				},
			},
			artifactFiles: {
				...artifacts.artifactFiles,
				"opentelemetry-signal-projection.json": forgedGrammarBytes,
			},
			...executableBindings(artifacts, bindings),
			program,
		}),
	).rejects.toThrow(
		"OpenTelemetry ingress and HTTP terminal grammar does not match Runtime",
	);
	const { digest: _digest, ...unsignedBuild } = artifacts.runtimeBuild;
	const mismatchedBuild = {
		...unsignedBuild,
		manifestDigest: sha("0"),
	};
	await expect(
		createRuntimeApplication({
			artifacts: {
				...runtimeArtifactEnvelope(artifacts),
				runtimeBuild: {
					...mismatchedBuild,
					digest: digest("questpie-runtime-build-v1", mismatchedBuild),
				},
			},
			artifactFiles: artifacts.artifactFiles,
			...executableBindings(artifacts, bindings),
			program,
		}),
	).rejects.toThrow(
		"manifestDigest does not match inventory path manifest.json",
	);
	const forgedExecutables = {
		...artifacts.runtimeExecutables,
		slots: artifacts.runtimeExecutables.slots.map((slot, index) =>
			index === 0 ? { ...slot, sourceDigest: sha("0") } : slot,
		),
	};
	const forgedExecutablesBytes = `${JSON.stringify(forgedExecutables)}\n`;
	const { digest: _runtimeBuildDigest, ...unsignedRuntimeBuild } =
		artifacts.runtimeBuild;
	const forgedInventoryBuild = {
		...unsignedRuntimeBuild,
		inventory: unsignedRuntimeBuild.inventory.map((item) =>
			item.path === "runtime-executables.json"
				? { ...item, digest: fileDigest(forgedExecutablesBytes) }
				: item,
		),
	};
	await expect(
		createRuntimeApplication({
			artifacts: {
				...runtimeArtifactEnvelope(artifacts),
				runtimeBuild: {
					...forgedInventoryBuild,
					digest: digest("questpie-runtime-build-v1", forgedInventoryBuild),
				},
			},
			artifactFiles: {
				...artifacts.artifactFiles,
				"runtime-executables.json": forgedExecutablesBytes,
			},
			...executableBindings(artifacts, bindings),
			program,
		}),
	).rejects.toThrow("runtime-executables.json semantic digest does not match");
	expect({ readiness, resolves, handlerCalls }).toEqual({
		readiness: 0,
		resolves: 0,
		handlerCalls: 0,
	});
});

test("runs one valid build through the direct operation engine", async () => {
	let handlerCalls = 0;
	let projectionCalls = 0;
	const context = defineContext({
		name: "app.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({
			tenant: { id: input.companyId },
			values: {},
		}),
	});
	const artifacts = runtimeArtifacts();
	const bindings = [
		{
			identity: "context:app.context",
			kind: "context" as const,
			slot: "resolve" as const,
			runtimeGraphDigest: sha("3"),
			bundleExport: "context_app_context_resolve",
			definition: context,
		},
		queryExecutable(({ input }) => {
			handlerCalls += 1;
			return { count: (input as Readonly<{ first: number }>).first };
		}),
	];
	const program = {
		services: [],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: ({ facts }: { facts: { signal: AbortSignal } }) => {
			projectionCalls += 1;
			return { signal: facts.signal };
		},
		resolvePrincipal: async () => principal.anonymous(),
	};
	const executableInput = executableBindings(artifacts, bindings);
	for (const invalidOptions of [
		{ maximumActiveRootsPerPrincipal: 0 },
		{ drainMilliseconds: Number.NaN },
	]) {
		await expect(
			createRuntimeApplication({
				artifacts: runtimeArtifactEnvelope(artifacts),
				artifactFiles: artifacts.artifactFiles,
				...executableInput,
				program,
				...invalidOptions,
			}),
		).rejects.toThrow("safe integer");
	}
	await expect(
		createRuntimeApplication({
			artifacts: runtimeArtifactEnvelope(artifacts),
			artifactFiles: artifacts.artifactFiles,
			...executableInput,
			serverExports: {
				...executableInput.serverExports,
				query_messages_page_handler: () => ({ count: 0 }),
			},
			program,
		}),
	).rejects.toThrow("server export pointer does not match");
	const app = await createRuntimeApplication({
		artifacts: runtimeArtifactEnvelope(artifacts),
		artifactFiles: artifacts.artifactFiles,
		...executableInput,
		program,
	});
	const result = await app.execution(
		{
			principal: principal.user({
				id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
			}),
			context: { companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0" },
		},
		(operations) => operations.invoke("query:messages.page", { first: 2 }),
	);
	expect(result).toEqual({ count: 2 });
	expect(handlerCalls).toBe(1);
	expect(projectionCalls).toBe(1);
	await app.close({ deadlineAt: Date.now() + 2_000 });
});

test("does zero observation work when the optional boundary is absent", () => {
	expect(
		createApplicationObservation({
			applicationIdentity: "application:collaboration",
			runtimeBuildDigest: sha("a"),
			questpieVersion: "4.0.0-beta.1",
		}),
	).toBeNull();
	expect(() =>
		createApplicationObservation({
			applicationIdentity: "application:collaboration",
			runtimeBuildDigest: sha("a"),
			signalProjectionDigest: sha("b"),
			questpieVersion: "4.0.0-beta.1",
			observability: createObservationHandle({
				format: "questpie.runtime-observability",
				version: 1,
			} as never),
		}),
	).toThrow("Runtime observation adapter is incompatible");
});

test("keeps one direct Query result and error across absent, sampled, working, and faulting observation", async () => {
	let readinessChecks = 0;
	const context = defineContext({
		name: "app.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const artifacts = runtimeArtifacts();
	let handlerCalls = 0;
	const bindings = [
		{
			identity: "context:app.context",
			kind: "context" as const,
			slot: "resolve" as const,
			runtimeGraphDigest: sha("3"),
			bundleExport: "context_app_context_resolve",
			definition: context,
		},
		queryExecutable(({ input }) => {
			handlerCalls += 1;
			if ((input as Readonly<{ first: number }>).first === 8)
				throw new Error("private handler failure");
			return { count: 7 };
		}),
	];
	const program = {
		services: [],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: ({ facts }: { facts: { signal: AbortSignal } }) => ({
			signal: facts.signal,
		}),
		resolvePrincipal: async () => principal.anonymous(),
		verifyReadiness: () => {
			readinessChecks += 1;
		},
	};
	await expect(
		createRuntimeApplication({
			artifacts: runtimeArtifactEnvelope(artifacts),
			artifactFiles: artifacts.artifactFiles,
			...executableBindings(artifacts, bindings),
			program,
			observability: {} as never,
		}),
	).rejects.toThrow("Runtime observation handle is incompatible");
	expect(readinessChecks).toBe(0);

	for (const mode of [
		"absent",
		"sampled",
		"working",
		"pre-entry-fault",
	] as const) {
		const events: ExecutionEventV2[] = [];
		const begins: string[] = [];
		const runs: string[] = [];
		const adapter: ObservationAdapterV1 | undefined =
			mode === "absent"
				? undefined
				: {
						format: "questpie.runtime-observability",
						version: 1,
						extract: () => null,
						begin(input) {
							begins.push(input.kind);
							return {
								context:
									mode === "working"
										? {
												format: "questpie.trace-context",
												version: 1,
												traceId: new Uint8Array(16).fill(1),
												spanId: new Uint8Array(8).fill(2),
												flags: 1,
											}
										: null,
								async run(use) {
									if (mode === "pre-entry-fault")
										throw new Error("adapter down");
									runs.push(`enter:${input.kind}`);
									try {
										return await use();
									} finally {
										runs.push(`exit:${input.kind}`);
									}
								},
								event: () => undefined,
								end: () => undefined,
							};
						},
					};
		const before = handlerCalls;
		const app = await createRuntimeApplication({
			artifacts: runtimeArtifactEnvelope(artifacts),
			artifactFiles: artifacts.artifactFiles,
			...executableBindings(artifacts, bindings),
			program,
			...(adapter === undefined
				? {}
				: { observability: createObservationHandle(adapter) }),
			events: (event) => events.push(event),
		});
		expect(events.map((event) => [event.kind, event.scopeKind])).toEqual([
			["scope.started", "runtime"],
		]);
		expect(begins).toEqual(mode === "absent" ? [] : ["runtime"]);
		events.length = 0;
		begins.length = 0;
		const result = await app.execution(
			{
				principal: principal.anonymous(),
				context: { companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0" },
			},
			(operations) => operations.invoke("query:messages.page", { first: 7 }),
		);
		expect(result).toEqual({ count: 7 });
		expect(handlerCalls - before).toBe(1);
		expect(events.map((event) => [event.kind, event.scopeKind])).toEqual([
			["scope.started", "execution"],
			["scope.event", "execution"],
			["scope.started", "query"],
			["scope.ended", "query"],
			["scope.ended", "execution"],
		]);
		expect(begins).toEqual(mode === "absent" ? [] : ["execution", "query"]);
		events.length = 0;
		begins.length = 0;
		const beforeError = handlerCalls;
		await expect(
			app.execution(
				{
					principal: principal.anonymous(),
					context: { companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0" },
				},
				(operations) => operations.invoke("query:messages.page", { first: 8 }),
			),
		).rejects.toMatchObject({ code: "INTERNAL" });
		expect(handlerCalls - beforeError).toBe(1);
		expect(
			events
				.filter((event) => event.kind === "scope.ended")
				.map((event) => [event.scopeKind, event.end.outcome]),
		).toEqual([
			["query", "framework_error"],
			["execution", "framework_error"],
		]);
		expect(begins).toEqual(mode === "absent" ? [] : ["execution", "query"]);
		events.length = 0;
		begins.length = 0;
		runs.length = 0;
		const cancelled = new AbortController();
		cancelled.abort(new DOMException("Run cancelled", "AbortError"));
		let workerUseCalls = 0;
		expect(
			await app.workerExecution(
				{
					principal: principal.anonymous(),
					context: {
						companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
					},
					signal: cancelled.signal,
				},
				async (observation, proceed) => {
					if (mode === "working") {
						await runObservedDurableAttempt({
							observation,
							request: {
								acceptanceTrace: null,
								capability: "job",
								attemptId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6202",
								attemptNumber: 1,
								queueDelayMilliseconds: 0,
								contextInput: {},
								dispatchId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6201",
								principal: { kind: "anonymous", id: "anonymous" },
								resource: "job:reports.companyDigest",
								runId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200",
								signal: cancelled.signal,
							},
							use: async () => {
								try {
									await proceed();
								} catch (error) {
									expect(error).toBe(cancelled.signal.reason);
								}
								return {
									attemptNumber: 1,
									failureCode: null,
									outcome: "cancelled",
									resource: "job:reports.companyDigest",
									runId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200",
								};
							},
						});
						return "settled-cancelled";
					}
					try {
						return await proceed();
					} catch (error) {
						expect(error).toBe(cancelled.signal.reason);
						return "settled-cancelled";
					}
				},
				async () => {
					workerUseCalls += 1;
					return "unreachable";
				},
			),
		).toBe("settled-cancelled");
		expect(workerUseCalls).toBe(0);
		expect(
			events
				.filter((event) => event.kind === "scope.ended")
				.map((event) => [event.scopeKind, event.end.outcome]),
		).toEqual(
			mode === "working"
				? [
						["job.attempt", "cancelled"],
						["execution", "cancelled"],
					]
				: [["execution", "cancelled"]],
		);
		if (mode === "working") {
			expect(begins).toEqual(["execution", "job.attempt"]);
			expect(runs).toEqual([
				"enter:execution",
				"enter:job.attempt",
				"exit:job.attempt",
				"exit:execution",
			]);
		}
		events.length = 0;
		await app.close({ deadlineAt: Date.now() + 2_000 });
		expect(
			events
				.filter((event) => event.kind === "scope.ended")
				.map((event) => [event.scopeKind, event.end.outcome]),
		).toEqual([["runtime", "ok"]]);
	}
});

test("carries one issued Execution privately through direct and network Action", async () => {
	const context = defineContext({
		name: "app.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const action = {
		identity: "action:delivery.publish",
		admission: "authenticated",
		limits: {
			inputBytes: 1_024,
			resultBytes: 1_024,
			durationMilliseconds: 5_000,
		},
		input: codec.object({ message: codec.text() }),
		output: codec.object({ receipt: codec.text() }),
		declaredErrors: [],
		execute: () => ({ receipt: "sent" }),
	} satisfies RuntimeActionBinding<Readonly<{ marker: true }>>;
	const actions = createRuntimeActionExecutor({
		application: "application:collaboration",
		bindings: [action],
		project: () => Object.freeze({ marker: true as const }),
	});
	const actionSlot = {
		identity: action.identity,
		kind: "action" as const,
		slot: "handler" as const,
		origin: {
			path: "src/delivery-action.ts",
			exportName: "deliveryPublish",
			packageId: null,
		},
		sourceDigest: sha("a"),
		contractDigest: sha("b"),
		runtimeGraphDigest: sha("c"),
		bundleExport: "action_delivery_publish_handler",
	};
	const artifacts = runtimeArtifacts([actionSlot], [action.identity]);
	const events: ExecutionEventV2[] = [];
	const executableAction = {
		...actionSlot,
		execute: action.execute,
		definition: { name: "delivery.publish", handler: action.execute },
	};
	const app = await createRuntimeApplication({
		artifacts: runtimeArtifactEnvelope(artifacts),
		artifactFiles: artifacts.artifactFiles,
		...executableBindings(artifacts, [
			{
				identity: "context:app.context",
				kind: "context" as const,
				slot: "resolve" as const,
				runtimeGraphDigest: sha("3"),
				bundleExport: "context_app_context_resolve",
				definition: context,
			},
			queryExecutable(() => ({ count: 1 })),
			executableAction,
		]),
		program: {
			services: [],
			context,
			bootstrap: () => ({ get: async () => null }),
			project: ({ facts }) => ({ signal: facts.signal }),
			projectExecution: (scope) => ({ actionScope: scope }),
			invokeAction: ({
				callId,
				effectKey,
				execution,
				identity,
				input,
				timeoutMilliseconds,
			}) =>
				actions.invoke(identity, {
					callId,
					effectKey,
					input,
					scope: execution.actionScope,
					...(timeoutMilliseconds === undefined ? {} : { timeoutMilliseconds }),
				}),
			resolvePrincipal: async (request) => readIngressPrincipal(request),
		},
		events: (event) => events.push(event),
	});

	await expect(
		app.execution(
			{
				principal: principal.user({
					id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
				}),
				context: { companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0" },
			},
			({ execution }) =>
				actions.invoke(action.identity, {
					effectKey: "delivery-1",
					input: { message: "hello" },
					scope: execution.actionScope,
				}),
		),
	).resolves.toEqual({ receipt: "sent" });
	expect(events.map((event) => [event.kind, event.scopeKind])).toEqual([
		["scope.started", "runtime"],
		["scope.started", "execution"],
		["scope.event", "execution"],
		["scope.started", "action"],
		["scope.started", "action.effect"],
		["scope.ended", "action.effect"],
		["scope.ended", "action"],
		["scope.ended", "execution"],
	]);
	expect(
		new Set(
			events
				.filter((event) => event.scopeKind !== "runtime")
				.map((event) => event.executionId),
		),
	).toEqual(new Set([events[1]!.executionId]));

	events.length = 0;
	const user = principal.user({
		id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
	});
	const request = new Request(
		"http://runtime.test/_questpie/action/delivery.publish",
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"Effect-Key": "delivery-network-1",
				"Questpie-Application": artifacts.runtimeBuild.application,
				"Questpie-Call-Id": "call%3Anetwork-action",
				"Questpie-Client-Contract": artifacts.runtimeBuild.clientContractDigest,
				"Questpie-Timeout-Milliseconds": "1000",
				"Questpie-Wire-Digest": artifacts.httpContract.digest,
			},
			body: JSON.stringify({
				context: {
					companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
				},
				input: { message: "hello" },
			}),
		},
	);
	bindIngressPrincipal(request, user);
	const response = await app.fetch(request);
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({
		callId: "call:network-action",
		result: { receipt: "sent" },
	});
	expect(events.map((event) => [event.kind, event.scopeKind])).toEqual([
		["scope.started", "fetch"],
		["scope.started", "execution"],
		["scope.event", "execution"],
		["scope.started", "action"],
		["scope.started", "action.effect"],
		["scope.ended", "action.effect"],
		["scope.ended", "action"],
		["scope.ended", "execution"],
		["scope.ended", "fetch"],
	]);
	const executionId = events.find(
		(event) => event.scopeKind === "execution",
	)?.executionId;
	expect(
		events
			.filter((event) => event.scopeKind !== "fetch")
			.every((event) => event.executionId === executionId),
	).toBe(true);
	await app.close({ deadlineAt: Date.now() + 2_000 });
});

test("observes Live Query initial and recompute evaluations as distinct entries", async () => {
	const context = defineContext({
		name: "app.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const artifacts = runtimeArtifacts();
	const events: ExecutionEventV2[] = [];
	let evaluate!: (input: Readonly<Record<string, unknown>>) => Promise<unknown>;
	const observation = Object.freeze({
		recordContext: () => undefined,
		recordPostgresQuery: () => undefined,
		recordStructuralQuery: () => undefined,
		recordStructuralQueryReached: () => undefined,
		finish: () => {
			throw new Error("not used by the application bridge");
		},
	}) satisfies LiveQueryObservation;
	const app = await createRuntimeApplication({
		artifacts: runtimeArtifactEnvelope(artifacts),
		artifactFiles: artifacts.artifactFiles,
		...executableBindings(artifacts, [
			{
				identity: "context:app.context",
				kind: "context" as const,
				slot: "resolve" as const,
				runtimeGraphDigest: sha("3"),
				bundleExport: "context_app_context_resolve",
				definition: context,
			},
			queryExecutable(({ input }) => ({
				count: (input as Readonly<{ first: number }>).first,
			})),
		]),
		program: {
			services: [],
			context,
			bootstrap: () => ({ get: async () => null }),
			project: ({ facts }) => ({ signal: facts.signal }),
			resolvePrincipal: async () => principal.anonymous(),
			createRealtime: (input) => {
				evaluate = input.evaluate as typeof evaluate;
				return {
					fetch: async () => null,
					beginDrain: () => undefined,
					drain: async () => undefined,
				};
			},
		},
		events: (event) => events.push(event),
	});
	const caller = principal.user({
		id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
	});
	for (const entry of ["watch_initial", "watch_recompute"] as const)
		await expect(
			evaluate({
				entry,
				principal: caller,
				context: { companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0" },
				query: "query:messages.page",
				input: { first: 2 },
				signal: new AbortController().signal,
				observation,
			}),
		).resolves.toEqual({ count: 2 });

	expect(
		events
			.filter((event) => event.kind === "scope.started")
			.map((event) => [event.scopeKind, event.start.entry]),
	).toEqual([
		["runtime", undefined],
		["execution", "watch_initial"],
		["query", "watch_initial"],
		["execution", "watch_recompute"],
		["query", "watch_recompute"],
	]);
	await app.close({ deadlineAt: Date.now() + 2_000 });
});

test("does not publish Runtime readiness before durable Live Query startup reconciliation", async () => {
	const context = defineContext({
		name: "app.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({
			tenant: { id: input.companyId },
			values: {},
		}),
	});
	const artifacts = runtimeArtifacts();
	const bindings = [
		{
			identity: "context:app.context",
			kind: "context" as const,
			slot: "resolve" as const,
			runtimeGraphDigest: sha("3"),
			bundleExport: "context_app_context_resolve",
			definition: context,
		},
		queryExecutable(() => ({ count: 1 })),
	];
	let releaseStartup!: () => void;
	let reportStarted!: () => void;
	const startupReleased = new Promise<void>((resolve) => {
		releaseStartup = resolve;
	});
	const startupEntered = new Promise<void>((resolve) => {
		reportStarted = resolve;
	});
	const events: ExecutionEventV2[] = [];
	let coordinatorDrains = 0;
	const creation = createRuntimeApplication({
		artifacts: runtimeArtifactEnvelope(artifacts),
		artifactFiles: artifacts.artifactFiles,
		...executableBindings(artifacts, bindings),
		program: {
			services: [],
			context,
			bootstrap: () => ({ get: async () => null }),
			project: ({ facts }) => ({ signal: facts.signal }),
			resolvePrincipal: async () => principal.anonymous(),
			liveQueryCoordinator: {
				async start() {
					reportStarted();
					await startupReleased;
				},
				async drain() {
					coordinatorDrains += 1;
				},
				async reconcile() {},
			},
		},
		events: (event) => events.push(event),
	});
	await startupEntered;
	expect(events).toEqual([]);
	releaseStartup();
	const app = await creation;
	expect(events.map((event) => [event.kind, event.scopeKind])).toEqual([
		["scope.started", "runtime"],
	]);
	await app.close({ deadlineAt: Date.now() + 2_000 });
	expect(coordinatorDrains).toBe(1);

	const startupFailure = new Error("startup reconciliation failed");
	const failedLifecycle: string[] = [];
	await expect(
		createRuntimeApplication({
			artifacts: runtimeArtifactEnvelope(artifacts),
			artifactFiles: artifacts.artifactFiles,
			...executableBindings(artifacts, bindings),
			program: {
				services: [],
				context,
				bootstrap: () => ({ get: async () => null }),
				project: ({ facts }) => ({ signal: facts.signal }),
				resolvePrincipal: async () => principal.anonymous(),
				liveQueryCoordinator: {
					async start() {
						failedLifecycle.push("start");
						throw startupFailure;
					},
					async drain() {
						failedLifecycle.push("drain");
					},
					async reconcile() {},
				},
			},
		}),
	).rejects.toBe(startupFailure);
	expect(failedLifecycle).toEqual(["start", "drain"]);
});

test("sanitizes unknown operation errors identically for direct and canonical network calls", async () => {
	const context = defineContext({
		name: "app.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({
			tenant: { id: input.companyId },
			values: {},
		}),
	});
	const artifacts = runtimeArtifacts();
	const bindings = [
		{
			identity: "context:app.context",
			kind: "context" as const,
			slot: "resolve" as const,
			runtimeGraphDigest: sha("3"),
			bundleExport: "context_app_context_resolve",
			definition: context,
		},
		queryExecutable(() => {
			throw new Error("postgres duplicate key detail");
		}),
	];
	const app = await createRuntimeApplication({
		artifacts: runtimeArtifactEnvelope(artifacts),
		artifactFiles: artifacts.artifactFiles,
		...executableBindings(artifacts, bindings),
		program: {
			services: [],
			context,
			bootstrap: () => ({ get: async () => null }),
			project: ({ facts }) => ({ signal: facts.signal }),
			resolvePrincipal: async () => principal.anonymous(),
		},
	});
	const user = principal.user({
		id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
	});
	const contextInput = {
		companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
	};
	const direct = app.execution(
		{ principal: user, context: contextInput },
		(operations) => operations.invoke("query:messages.page", { first: 2 }),
	);
	await expect(direct).rejects.toMatchObject({ code: "INTERNAL" });
	await direct.catch((error: unknown) => {
		expect(String(error)).not.toContain("duplicate key");
	});

	const request = new Request(
		"http://runtime.test/_questpie/query/messages.page?first=2",
		{
			headers: {
				"Questpie-Application": artifacts.runtimeBuild.application,
				"Questpie-Call-Id": "network-call",
				"Questpie-Client-Contract": artifacts.runtimeBuild.clientContractDigest,
				"Questpie-Context": Buffer.from(JSON.stringify(contextInput)).toString(
					"base64url",
				),
				"Questpie-Wire-Digest": artifacts.httpContract.digest,
			},
		},
	);
	bindIngressPrincipal(request, user);
	const response = await app.fetch(request);
	const responseText = await response.text();
	expect(response.status).toBe(500);
	expect(JSON.parse(responseText)).toEqual({
		callId: "network-call",
		error: { code: "INTERNAL", retryable: false },
	});
	expect(responseText).not.toContain("duplicate key");
	await app.close({ deadlineAt: Date.now() + 2_000 });
});

test("runs one canonical Query GET through the existing Operation executor", async () => {
	let handlerCalls = 0;
	const context = defineContext({
		name: "app.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({
			tenant: { id: input.companyId },
			values: {},
		}),
	});
	const artifacts = runtimeArtifacts();
	const bindings = [
		{
			identity: "context:app.context",
			kind: "context" as const,
			slot: "resolve" as const,
			runtimeGraphDigest: sha("3"),
			bundleExport: "context_app_context_resolve",
			definition: context,
		},
		queryExecutable(({ input }) => {
			handlerCalls += 1;
			const first = (input as Readonly<{ first: number }>).first;
			if (first === 3) throw new Error("private failure");
			return { count: first };
		}),
	];
	const app = await createRuntimeApplication({
		artifacts: runtimeArtifactEnvelope(artifacts),
		artifactFiles: artifacts.artifactFiles,
		...executableBindings(artifacts, bindings),
		program: {
			services: [],
			context,
			bootstrap: () => ({ get: async () => null }),
			project: ({ facts }) => ({ signal: facts.signal }),
			resolvePrincipal: async (request) => readIngressPrincipal(request),
		},
	});
	const user = principal.user({
		id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
	});
	const contextInput = {
		companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
	};
	expect(
		await app.execution(
			{ principal: user, context: contextInput },
			(operations) => operations.invoke("query:messages.page", { first: 2 }),
		),
	).toEqual({ count: 2 });
	const request = new Request(
		"http://runtime.test/_questpie/query/messages.page?first=2",
		{
			headers: {
				"Questpie-Application": artifacts.runtimeBuild.application,
				"Questpie-Call-Id": "canonical-query-1",
				"Questpie-Client-Contract": artifacts.runtimeBuild.clientContractDigest,
				"Questpie-Context": Buffer.from(JSON.stringify(contextInput)).toString(
					"base64url",
				),
				"Questpie-Timeout-Milliseconds": "5000",
				"Questpie-Wire-Digest": artifacts.httpContract.digest,
			},
		},
	);
	bindIngressPrincipal(request, user);
	const response = await app.fetch(request);
	expect(response.status).toBe(200);
	expect(response.headers.get("content-type")).toBe(
		"application/json; charset=utf-8",
	);
	expect(response.headers.get("cache-control")).toBe("private, no-store");
	expect(await response.json()).toEqual({
		callId: "canonical-query-1",
		result: { count: 2 },
	});
	expect(handlerCalls).toBe(2);
	const privateFailure = new Request(
		"http://runtime.test/_questpie/query/messages.page?first=3",
		{ headers: request.headers },
	);
	bindIngressPrincipal(privateFailure, user);
	const privateFailureResponse = await app.fetch(privateFailure);
	expect(privateFailureResponse.status).toBe(500);
	expect(await privateFailureResponse.json()).toEqual({
		callId: "canonical-query-1",
		error: { code: "INTERNAL", retryable: false },
	});
	const headers = {
		"Questpie-Application": artifacts.runtimeBuild.application,
		"Questpie-Call-Id": "canonical-hostile-1",
		"Questpie-Client-Contract": artifacts.runtimeBuild.clientContractDigest,
		"Questpie-Context": Buffer.from(JSON.stringify(contextInput)).toString(
			"base64url",
		),
		"Questpie-Wire-Digest": artifacts.httpContract.digest,
	};
	for (const hostile of [
		"http://runtime.test/_questpie/query/messages.page?first=2&first=2",
		"http://runtime.test/_questpie/query/messages.page?unknown=2",
		"http://runtime.test/_questpie/query/messages.page?first=%32",
	]) {
		const invalid = new Request(hostile, { headers });
		bindIngressPrincipal(invalid, user);
		const invalidResponse = await app.fetch(invalid);
		expect(invalidResponse.status).toBe(400);
		expect(invalidResponse.headers.get("cache-control")).toBe(
			"private, no-store",
		);
	}
	const malformedContext = new Request(
		"http://runtime.test/_questpie/query/messages.page?first=2",
		{ headers: { ...headers, "Questpie-Context": "abc=" } },
	);
	bindIngressPrincipal(malformedContext, user);
	expect((await app.fetch(malformedContext)).status).toBe(400);
	const noPostFallback = new Request(
		"http://runtime.test/_questpie/query/messages.page?first=2",
		{ method: "POST", headers },
	);
	bindIngressPrincipal(noPostFallback, user);
	expect((await app.fetch(noPostFallback)).status).toBe(400);
	const invisible = new Request(
		"http://runtime.test/_questpie/query/messages.missing?first=2",
		{ headers },
	);
	bindIngressPrincipal(invisible, user);
	expect((await app.fetch(invisible)).status).toBe(404);
	const credentialBeforeDecode = new Request(
		"http://runtime.test/_questpie/query/messages.page?unknown=2",
		{ headers },
	);
	expect((await app.fetch(credentialBeforeDecode)).status).toBe(401);
	const removedOperationRoute = await app.fetch(
		new Request("http://runtime.test/_questpie/operation", {
			method: "POST",
		}),
	);
	expect(removedOperationRoute.status).toBe(404);
	expect(removedOperationRoute.headers.get("content-type")).toBeNull();
	expect(handlerCalls).toBe(3);
	await app.close({ deadlineAt: Date.now() + 2_000 });
});

test("canonical Fetch deadlines ignore wall-clock rollback and saturated host timers", async () => {
	let wall = 1_000;
	let credentialMode: "resolved" | "rollback" = "rollback";
	let executionSignal: AbortSignal | undefined;
	let handlerCalls = 0;
	const context = defineContext({
		name: "app.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({
			tenant: { id: input.companyId },
			values: {},
		}),
	});
	const artifacts = runtimeArtifacts();
	const bindings = [
		{
			identity: "context:app.context",
			kind: "context" as const,
			slot: "resolve" as const,
			runtimeGraphDigest: sha("3"),
			bundleExport: "context_app_context_resolve",
			definition: context,
		},
		queryExecutable(async ({ input, ctx }) => {
			handlerCalls += 1;
			executionSignal = (ctx as Readonly<{ signal: AbortSignal }>).signal;
			await new Promise((resolve) => setTimeout(resolve, 15));
			return {
				count: (input as Readonly<{ first: number }>).first,
			};
		}),
	];
	const user = principal.user({
		id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
	});
	const app = await createRuntimeApplication({
		artifacts: runtimeArtifactEnvelope(artifacts),
		artifactFiles: artifacts.artifactFiles,
		...executableBindings(artifacts, bindings),
		program: {
			services: [],
			context,
			bootstrap: () => ({ get: async () => null }),
			project: ({ facts }) => ({ signal: facts.signal }),
			resolvePrincipal: async () => {
				if (credentialMode === "rollback") {
					wall = -100_000;
					return new Promise<never>(() => {});
				}
				return user;
			},
		},
		now: () => new Date(wall),
	});
	const contextInput = {
		companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
	};
	const headers = {
		"Questpie-Application": artifacts.runtimeBuild.application,
		"Questpie-Client-Contract": artifacts.runtimeBuild.clientContractDigest,
		"Questpie-Context": Buffer.from(JSON.stringify(contextInput)).toString(
			"base64url",
		),
		"Questpie-Wire-Digest": artifacts.httpContract.digest,
	};
	const rolledBack = await Promise.race([
		app.fetch(
			new Request("http://runtime.test/_questpie/query/messages.page?first=2", {
				headers: {
					...headers,
					"Questpie-Call-Id": "wall-clock-rollback",
					"Questpie-Timeout-Milliseconds": "5",
				},
			}),
		),
		new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 100)),
	]);
	expect(rolledBack).not.toBe("hung");
	if (rolledBack === "hung") return;
	expect(rolledBack.status).toBe(408);
	expect(await rolledBack.json()).toEqual({
		callId: "wall-clock-rollback",
		error: { code: "DEADLINE_EXCEEDED", retryable: true },
	});
	expect(handlerCalls).toBe(0);

	credentialMode = "resolved";
	const requestController = new AbortController();
	const saturated = await app.fetch(
		new Request("http://runtime.test/_questpie/query/messages.page?first=2", {
			signal: requestController.signal,
			headers: {
				...headers,
				"Questpie-Call-Id": "saturated-timeout",
				"Questpie-Timeout-Milliseconds": String(Number.MAX_SAFE_INTEGER),
			},
		}),
	);
	expect(saturated.status).toBe(200);
	expect(await saturated.json()).toEqual({
		callId: "saturated-timeout",
		result: { count: 2 },
	});
	expect(handlerCalls).toBe(1);
	requestController.abort();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(executionSignal?.aborted).toBe(false);
	await app.close({ deadlineAt: Date.now() + 2_000 });
});

test("runs canonical Mutation POST and replay through the existing Mutation executor", async () => {
	const context = defineContext({
		name: "app.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const mutationSlot = {
		identity: "mutation:messages.publish",
		kind: "mutation" as const,
		slot: "handler" as const,
		origin: {
			path: "src/messages-publish.ts",
			exportName: "messagesPublish",
			packageId: null,
		},
		sourceDigest: sha("a"),
		contractDigest: sha("b"),
		runtimeGraphDigest: sha("c"),
		bundleExport: "mutation_messages_publish_handler",
	};
	const definition = {
		name: "messages.publish",
		handler: () => {
			throw new Error("the Runtime Mutation executor owns invocation");
		},
	};
	const mutationBinding = {
		identity: mutationSlot.identity,
		kind: mutationSlot.kind,
		slot: mutationSlot.slot,
		runtimeGraphDigest: mutationSlot.runtimeGraphDigest,
		bundleExport: mutationSlot.bundleExport,
		execute: definition.handler,
		definition,
	};
	const contextBinding = {
		identity: "context:app.context",
		kind: "context" as const,
		slot: "resolve" as const,
		runtimeGraphDigest: sha("3"),
		bundleExport: "context_app_context_resolve",
		definition: context,
	};
	const artifacts = runtimeArtifacts([mutationSlot]);
	const receipts = new Map<string, string>();
	let mutationExecutions = 0;
	let abortAfterCommit: (() => void) | undefined;
	const app = await createRuntimeApplication({
		artifacts: runtimeArtifactEnvelope(artifacts),
		artifactFiles: artifacts.artifactFiles,
		...executableBindings(artifacts, [
			contextBinding,
			queryExecutable(() => ({ count: 1 })),
			mutationBinding,
		]),
		program: {
			services: [],
			context,
			bootstrap: () => ({ get: async () => null }),
			project: ({ facts }) => ({ signal: facts.signal }),
			projectMutation: () => async (operation, callId) => {
				let value = receipts.get(callId);
				if (value === undefined) {
					mutationExecutions += 1;
					value = `stored:${String(operation.input)}`;
					receipts.set(callId, value);
				}
				if (callId === "post-commit-cancel") abortAfterCommit?.();
				return { committed: true, transactionId: "901", value };
			},
			resolvePrincipal: async () => principal.anonymous(),
		},
	});
	const contextInput = {
		companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
	};
	expect(
		await app.execution(
			{ principal: principal.anonymous(), context: contextInput },
			(operations) =>
				operations.invoke("mutation:messages.publish", "hello", {
					callId: "replay-key",
				}),
		),
	).toBe("stored:hello");
	const send = () =>
		app.fetch(
			new Request("http://runtime.test/_questpie/mutation/messages.publish", {
				method: "POST",
				headers: {
					"content-type": "application/json; Charset=UTF-8",
					"Idempotency-Key": "replay-key",
					"Questpie-Application": artifacts.runtimeBuild.application,
					"Questpie-Client-Contract":
						artifacts.runtimeBuild.clientContractDigest,
					"Questpie-Wire-Digest": artifacts.httpContract.digest,
				},
				body: JSON.stringify({ context: contextInput, input: "hello" }),
			}),
		);
	for (let replay = 0; replay < 2; replay += 1) {
		const response = await send();
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			callId: "replay-key",
			result: "stored:hello",
		});
	}
	expect(mutationExecutions).toBe(1);
	const postCommitController = new AbortController();
	abortAfterCommit = () =>
		postCommitController.abort(
			new DOMException("response transport left", "AbortError"),
		);
	const postCommit = await app.fetch(
		new Request("http://runtime.test/_questpie/mutation/messages.publish", {
			method: "POST",
			signal: postCommitController.signal,
			headers: {
				"content-type": "application/json",
				"Idempotency-Key": "post-commit-cancel",
			},
			body: JSON.stringify({ context: contextInput, input: "hello" }),
		}),
	);
	expect(postCommit.status).toBe(500);
	expect(await postCommit.json()).toEqual({
		callId: "post-commit-cancel",
		error: {
			code: "COMMITTED_RESULT_UNAVAILABLE",
			retryable: true,
			transactionId: "901",
		},
	});
	abortAfterCommit = undefined;
	const recovered = await app.fetch(
		new Request("http://runtime.test/_questpie/mutation/messages.publish", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"Idempotency-Key": "post-commit-cancel",
			},
			body: JSON.stringify({ context: contextInput, input: "hello" }),
		}),
	);
	expect(recovered.status).toBe(200);
	expect(await recovered.json()).toEqual({
		callId: "post-commit-cancel",
		result: "stored:hello",
	});
	expect(mutationExecutions).toBe(2);
	await app.close({ deadlineAt: Date.now() + 2_000 });
});

test("canonical Fetch preserves Action deadline and post-dispatch outcome semantics", async () => {
	const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
	const caller = principal.user({
		id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
	});
	const modes = ["wall-clock", "pre-dispatch", "settled", "unsettled"] as const;

	for (const mode of modes) {
		const requestController = new AbortController();
		let handlerCalls = 0;
		const context = defineContext({
			name: "app.context",
			input: codec.object({ companyId: codec.uuid() }),
			resolve: ({ input }) => ({
				tenant: { id: input.companyId },
				values: {},
			}),
		});
		const actionSlot = {
			identity: "action:delivery.publish",
			kind: "action" as const,
			slot: "handler" as const,
			origin: {
				path: "src/delivery-action.ts",
				exportName: "publishDelivery",
				packageId: null,
			},
			sourceDigest: sha("a"),
			contractDigest: sha("b"),
			runtimeGraphDigest: sha("c"),
			bundleExport: "action_delivery_publish_handler",
		};
		const execute = () => {
			handlerCalls += 1;
			if (mode === "unsettled") {
				requestController.abort(
					new DOMException("caller left after dispatch", "AbortError"),
				);
			}
			if (mode === "unsettled") throw requestController.signal.reason;
			return { receipt: "accepted" };
		};
		const actionBinding = {
			identity: actionSlot.identity,
			admission: "authenticated",
			limits: {
				inputBytes: 1_024,
				resultBytes: 1_024,
				durationMilliseconds: 1_000,
			},
			input: {
				kind: "object",
				properties: { message: { kind: "text" } },
			},
			output: {
				kind: "object",
				properties: { receipt: { kind: "text" } },
			},
			declaredErrors: [],
			execute,
		} satisfies RuntimeActionBinding<Readonly<{ signal: AbortSignal }>>;
		const actionExecutor = createRuntimeActionExecutor({
			application: "application:collaboration",
			bindings: [actionBinding],
			project: async (scope) => {
				if (mode === "pre-dispatch") {
					requestController.abort(
						new DOMException("caller left before dispatch", "AbortError"),
					);
					throw scope.signal.reason;
				}
				return Object.freeze({ signal: scope.signal });
			},
		});
		const executableActionBinding = {
			identity: actionSlot.identity,
			kind: actionSlot.kind,
			slot: actionSlot.slot,
			runtimeGraphDigest: actionSlot.runtimeGraphDigest,
			bundleExport: actionSlot.bundleExport,
			execute,
			definition: { name: "delivery.publish", handler: execute },
		};
		const artifacts = runtimeArtifacts([actionSlot]);
		const app = await createRuntimeApplication({
			artifacts: runtimeArtifactEnvelope(artifacts),
			artifactFiles: artifacts.artifactFiles,
			...executableBindings(artifacts, [
				{
					identity: "context:app.context",
					kind: "context" as const,
					slot: "resolve" as const,
					runtimeGraphDigest: sha("3"),
					bundleExport: "context_app_context_resolve",
					definition: context,
				},
				queryExecutable(() => ({ count: 1 })),
				executableActionBinding,
			]),
			program: {
				services: [],
				context,
				bootstrap: () => ({ get: async () => null }),
				project: ({ facts }) => ({ signal: facts.signal }),
				projectExecution: (scope) => scope,
				invokeAction: async ({
					identity,
					input,
					effectKey,
					callId,
					timeoutMilliseconds,
					onHandlerDispatch,
					execution,
				}) => {
					const result = await actionExecutor.invoke(identity, {
						input,
						effectKey,
						callId,
						scope: execution,
						...(timeoutMilliseconds === undefined
							? {}
							: { timeoutMilliseconds }),
						...(onHandlerDispatch === undefined ? {} : { onHandlerDispatch }),
					});
					if (mode === "settled") {
						requestController.abort(
							new DOMException("caller left after result", "AbortError"),
						);
					}
					return result;
				},
				resolvePrincipal: async () => caller,
			},
		});
		const originalDateNow = Date.now;
		if (mode === "wall-clock") Date.now = () => Number.MAX_SAFE_INTEGER;
		let response: Response;
		try {
			response = await app.fetch(
				new Request("http://runtime.test/_questpie/action/delivery.publish", {
					method: "POST",
					signal: requestController.signal,
					headers: {
						"content-type": "application/json",
						"Effect-Key": `effect-secret-${mode}`,
						"Questpie-Call-Id": `action-${mode}`,
						"Questpie-Timeout-Milliseconds": "100",
					},
					body: JSON.stringify({
						context: { companyId },
						input: { message: "hello" },
					}),
				}),
			);
		} finally {
			Date.now = originalDateNow;
		}
		const body = await response.json();
		const expectedBody =
			mode === "pre-dispatch"
				? {
						callId: "action-pre-dispatch",
						error: { code: "DEADLINE_EXCEEDED", retryable: true },
					}
				: mode === "unsettled"
					? {
							callId: "action-unsettled",
							error: {
								code: "ACTION_OUTCOME_AMBIGUOUS",
								retryable: false,
							},
						}
					: {
							callId: `action-${mode}`,
							result: { receipt: "accepted" },
						};
		expect({ body, mode, status: response.status }).toEqual({
			body: expectedBody,
			mode,
			status: mode === "pre-dispatch" ? 408 : mode === "unsettled" ? 500 : 200,
		});
		expect(handlerCalls).toBe(mode === "pre-dispatch" ? 0 : 1);
		const encoded = JSON.stringify(body);
		expect(encoded).not.toContain("caller left");
		expect(encoded).not.toContain(`effect-secret-${mode}`);
		await app.close({ deadlineAt: Date.now() + 2_000 });
	}
});

test("rejects missing, duplicate, stale, wrong-kind and cross-build Action bindings", async () => {
	let resolves = 0;
	let handlerCalls = 0;
	let actionCalls = 0;
	const context = defineContext({
		name: "app.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => {
			resolves += 1;
			return { tenant: { id: input.companyId }, values: {} };
		},
	});
	const contextBinding = {
		identity: "context:app.context",
		kind: "context" as const,
		slot: "resolve" as const,
		runtimeGraphDigest: sha("3"),
		bundleExport: "context_app_context_resolve",
		definition: context,
	};
	const queryBinding = queryExecutable(() => {
		handlerCalls += 1;
		return { count: 1 };
	});
	const actionExecute = () => {
		actionCalls += 1;
		return { receipt: "not reached" };
	};
	const actionSlot = {
		identity: "action:delivery.publish",
		kind: "action" as const,
		slot: "handler" as const,
		origin: {
			path: "src/delivery-action.ts",
			exportName: "publishDelivery",
			packageId: null,
		},
		sourceDigest: sha("a"),
		contractDigest: sha("b"),
		runtimeGraphDigest: sha("c"),
		bundleExport: "action_delivery_publish_handler",
	};
	const actionBinding = {
		identity: actionSlot.identity,
		kind: actionSlot.kind,
		slot: actionSlot.slot,
		runtimeGraphDigest: actionSlot.runtimeGraphDigest,
		bundleExport: actionSlot.bundleExport,
		execute: actionExecute,
		definition: { name: "delivery.publish", handler: actionExecute },
	};
	const artifacts = () => runtimeArtifacts([actionSlot]);
	const mismatchedContractDigest = () => {
		const original = artifacts();
		const { digest: _digest, ...unsigned } = original.runtimeBuild;
		const changed = { ...unsigned, operationContractsDigest: sha("0") };
		return {
			...original,
			runtimeBuild: {
				...changed,
				digest: digest("questpie-runtime-build-v1", changed),
			},
		};
	};
	const program = {
		services: [],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: ({ facts }: { facts: { signal: AbortSignal } }) => ({
			signal: facts.signal,
		}),
		invokeAction: () => {
			throw new Error("not executed by artifact validation");
		},
		resolvePrincipal: async () => principal.anonymous(),
	};
	const accepted = artifacts();
	const application = await createRuntimeApplication({
		artifacts: runtimeArtifactEnvelope(accepted),
		artifactFiles: accepted.artifactFiles,
		...executableBindings(accepted, [
			contextBinding,
			queryBinding,
			actionBinding,
		]),
		program,
	});
	await application.close({ deadlineAt: Date.now() + 2_000 });
	const cases: readonly Readonly<{
		name: string;
		message: string;
		artifacts: unknown;
		bindings: unknown;
		runtimeBuildDigest?: string;
	}>[] = [
		{
			name: "slot-without-contract",
			message:
				"Action executable and operation contract inventories do not match",
			artifacts: runtimeArtifacts([actionSlot], []),
			bindings: [contextBinding, queryBinding, actionBinding],
		},
		{
			name: "contract-without-slot",
			message:
				"Action executable and operation contract inventories do not match",
			artifacts: runtimeArtifacts([], [actionSlot.identity]),
			bindings: [contextBinding, queryBinding],
		},
		{
			name: "contract-identity-mismatch",
			message:
				"Action executable and operation contract inventories do not match",
			artifacts: runtimeArtifacts([actionSlot], ["action:delivery.other"]),
			bindings: [contextBinding, queryBinding, actionBinding],
		},
		{
			name: "action-kind-with-query-identity",
			message: "Action executable kind does not match its identity",
			artifacts: runtimeArtifacts(
				[{ ...actionSlot, identity: "query:delivery.publish" }],
				[],
			),
			bindings: [contextBinding, queryBinding, actionBinding],
		},
		{
			name: "query-kind-with-action-identity",
			message: "Action executable kind does not match its identity",
			artifacts: runtimeArtifacts([{ ...actionSlot, kind: "query" }], []),
			bindings: [contextBinding, queryBinding, actionBinding],
		},
		{
			name: "contract-digest-mismatch",
			message: "operation contract digest does not match",
			artifacts: mismatchedContractDigest(),
			bindings: [contextBinding, queryBinding, actionBinding],
		},
		{
			name: "missing",
			message: "Runtime executable binding does not match",
			artifacts: artifacts(),
			bindings: [contextBinding, queryBinding],
		},
		{
			name: "duplicate",
			message: "Runtime executable binding is duplicate",
			artifacts: artifacts(),
			bindings: [contextBinding, queryBinding, actionBinding, actionBinding],
		},
		{
			name: "stale",
			message: "Runtime executable binding does not match",
			artifacts: artifacts(),
			bindings: [
				contextBinding,
				queryBinding,
				{ ...actionBinding, runtimeGraphDigest: sha("0") },
			],
		},
		{
			name: "wrong-kind",
			message: "Runtime executable binding does not match",
			artifacts: artifacts(),
			bindings: [
				contextBinding,
				queryBinding,
				{ ...actionBinding, kind: "service" },
			],
		},
		{
			name: "wrong-handler-pointer",
			message: "Runtime operation executable binding does not match",
			artifacts: artifacts(),
			bindings: [
				contextBinding,
				queryBinding,
				{
					...actionBinding,
					definition: { ...actionBinding.definition, handler: () => null },
				},
			],
		},
		{
			name: "cross-build",
			message: "Runtime executable binding is from another build",
			artifacts: artifacts(),
			bindings: [contextBinding, queryBinding, actionBinding],
			runtimeBuildDigest: sha("0"),
		},
	];
	for (const hostile of cases) {
		await expect(
			createRuntimeApplication({
				artifacts: runtimeArtifactEnvelope(
					hostile.artifacts as ReturnType<typeof runtimeArtifacts>,
				),
				artifactFiles: (
					hostile.artifacts as ReturnType<typeof runtimeArtifacts>
				).artifactFiles,
				bindings: {
					application: "application:collaboration",
					runtimeBuildDigest:
						hostile.runtimeBuildDigest ??
						(hostile.artifacts as ReturnType<typeof runtimeArtifacts>)
							.runtimeBuild.digest,
					slots: hostile.bindings as never,
				},
				serverExports: serverExportsFor([
					contextBinding,
					queryBinding,
					actionBinding,
				]),
				program,
			}),
		).rejects.toThrow(hostile.message);
	}
	expect({ actionCalls, handlerCalls, resolves }).toEqual({
		actionCalls: 0,
		handlerCalls: 0,
		resolves: 0,
	});
});

test("pairs the exact Context and Service exports before readiness", async () => {
	const context = defineContext({
		name: "app.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({
			tenant: { id: input.companyId },
			values: {},
		}),
	});
	const connection = defineService({
		name: "database.connection",
		lifetime: "application",
		effect: "read",
		create: () => ({ ready: true }),
		dispose: () => {},
	});
	const serviceSlots = [
		{
			identity: "service:database.connection",
			kind: "service",
			slot: "create",
			origin: {
				path: "src/services.ts",
				exportName: "connection",
				packageId: null,
			},
			sourceDigest: sha("1"),
			contractDigest: sha("2"),
			runtimeGraphDigest: sha("7"),
			bundleExport: "service_database_connection_create",
		},
		{
			identity: "service:database.connection",
			kind: "service",
			slot: "dispose",
			origin: {
				path: "src/services.ts",
				exportName: "connection",
				packageId: null,
			},
			sourceDigest: sha("1"),
			contractDigest: sha("2"),
			runtimeGraphDigest: sha("8"),
			bundleExport: "service_database_connection_dispose",
		},
	] as const;
	const artifacts = runtimeArtifacts(serviceSlots);
	const bindings = [
		{
			identity: "context:app.context",
			kind: "context" as const,
			slot: "resolve" as const,
			runtimeGraphDigest: sha("3"),
			bundleExport: "context_app_context_resolve",
			definition: context,
		},
		queryExecutable(() => ({ count: 1 })),
		...serviceSlots.map((slot) => ({
			identity: slot.identity,
			kind: slot.kind,
			slot: slot.slot,
			runtimeGraphDigest: slot.runtimeGraphDigest,
			bundleExport: slot.bundleExport,
			definition: connection,
		})),
	];
	const app = await createRuntimeApplication({
		artifacts: runtimeArtifactEnvelope(artifacts),
		artifactFiles: artifacts.artifactFiles,
		...executableBindings(artifacts, bindings),
		program: {
			services: [connection],
			context,
			bootstrap: () => ({ get: async () => null }),
			project: ({ facts }) => ({ signal: facts.signal }),
			resolvePrincipal: async () => principal.anonymous(),
		},
	});
	await app.close({ deadlineAt: Date.now() + 2_000 });
});

async function createHoldingRuntime(
	input: Readonly<{
		coordinatorDeadlines?: number[];
		coordinatorDrainFailure?: Error;
		drainMilliseconds?: number;
		events?: (event: unknown) => void;
		holdCoordinatorDrain?: boolean;
		ignoreAbort?: boolean;
	}> = {},
) {
	const releases: Array<() => void> = [];
	const context = defineContext({
		name: "app.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input: contextInput }) => ({
			tenant: { id: contextInput.companyId },
			values: {},
		}),
	});
	const artifacts = runtimeArtifacts();
	const bindings = [
		{
			identity: "context:app.context",
			kind: "context" as const,
			slot: "resolve" as const,
			runtimeGraphDigest: sha("3"),
			bundleExport: "context_app_context_resolve",
			definition: context,
		},
		queryExecutable(
			({ ctx }) =>
				new Promise<Readonly<{ count: number }>>((resolve, reject) => {
					const signal = (ctx as Readonly<{ signal: AbortSignal }>).signal;
					const release = () => resolve({ count: 1 });
					releases.push(release);
					if (!input.ignoreAbort)
						signal.addEventListener("abort", () => reject(signal.reason), {
							once: true,
						});
				}),
		),
	];
	const app = await createRuntimeApplication({
		artifacts: runtimeArtifactEnvelope(artifacts),
		artifactFiles: artifacts.artifactFiles,
		...executableBindings(artifacts, bindings),
		program: {
			services: [],
			context,
			bootstrap: () => ({ get: async () => null }),
			project: ({ facts }) => ({ signal: facts.signal }),
			resolvePrincipal: async () => principal.anonymous(),
			...(input.coordinatorDeadlines || input.coordinatorDrainFailure
				? {
						liveQueryCoordinator: {
							start: () => Promise.resolve(),
							drain(close: Readonly<{ deadlineAt: number }>) {
								input.coordinatorDeadlines?.push(close.deadlineAt);
								if (input.coordinatorDrainFailure)
									throw input.coordinatorDrainFailure;
								return input.holdCoordinatorDrain
									? new Promise<void>(() => {})
									: Promise.resolve();
							},
						},
					}
				: {}),
		},
		drainMilliseconds: input.drainMilliseconds,
		events: input.events,
	});
	return { app, releases, artifacts };
}

test("preserves a Runtime close failure and observes it once", async () => {
	const events: unknown[] = [];
	const closeFailure = new Error("coordinator close failed");
	const { app } = await createHoldingRuntime({
		coordinatorDrainFailure: closeFailure,
		events: (event) => events.push(event),
	});
	const closing = app.close({ deadlineAt: Date.now() + 2_000 });
	await expect(closing).rejects.toBe(closeFailure);
	await expect(app.close({ deadlineAt: Date.now() + 4_000 })).rejects.toBe(
		closeFailure,
	);
	expect(
		events
			.filter(
				(event): event is Extract<ExecutionEventV2, { kind: "scope.ended" }> =>
					event.kind === "scope.ended",
			)
			.map(({ end }) => [end.kind, end.outcome]),
	).toEqual([["runtime", "framework_error"]]);
});

test("separates runtime deadlines from Fetch disconnect cancellation", async () => {
	const { app, releases, artifacts } = await createHoldingRuntime();
	const context = {
		companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
	};
	await expect(
		app.execution(
			{
				principal: principal.anonymous(),
				context,
				deadline: Date.now() + 1,
			},
			(operations) => operations.invoke("query:messages.page", { first: 1 }),
		),
	).rejects.toThrow("DEADLINE_EXCEEDED");

	const disconnect = new AbortController();
	const request = new Request(
		"http://runtime.test/_questpie/query/messages.page?first=1",
		{
			headers: {
				"Questpie-Application": artifacts.runtimeBuild.application,
				"Questpie-Call-Id": "call%3Adisconnect",
				"Questpie-Client-Contract": artifacts.runtimeBuild.clientContractDigest,
				"Questpie-Context": Buffer.from(JSON.stringify(context)).toString(
					"base64url",
				),
				"Questpie-Wire-Digest": artifacts.httpContract.digest,
			},
			signal: disconnect.signal,
		},
	);
	const pending = app.fetch(request);
	while (releases.length < 2) await Bun.sleep(0);
	disconnect.abort();
	const response = await pending;
	expect(response.status).toBe(408);
	expect(await response.json()).toEqual({
		callId: "call:disconnect",
		error: { code: "DEADLINE_EXCEEDED", retryable: true },
	});
	await app.close({ deadlineAt: Date.now() + 2_000 });
});

test("preserves caller cancellation while Context Resolution is failing", async () => {
	let releaseResolution!: () => void;
	const resolutionBlocked = new Promise<void>((resolve) => {
		releaseResolution = resolve;
	});
	const context = defineContext({
		name: "app.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: async () => {
			await resolutionBlocked;
			throw new Error("PostgreSQL cancelled during begin");
		},
	});
	const artifacts = runtimeArtifacts();
	const bindings = [
		{
			identity: "context:app.context",
			kind: "context" as const,
			slot: "resolve" as const,
			runtimeGraphDigest: sha("3"),
			bundleExport: "context_app_context_resolve",
			definition: context,
		},
		queryExecutable(() => ({ count: 1 })),
	];
	const app = await createRuntimeApplication({
		artifacts: runtimeArtifactEnvelope(artifacts),
		artifactFiles: artifacts.artifactFiles,
		...executableBindings(artifacts, bindings),
		program: {
			services: [],
			context,
			bootstrap: () => ({ get: async () => null }),
			project: ({ facts }) => ({ signal: facts.signal }),
			resolvePrincipal: async () => principal.anonymous(),
		},
	});
	const cancellation = new AbortController();
	const reason = new DOMException("caller cancelled", "AbortError");
	const pending = app.execution(
		{
			principal: principal.anonymous(),
			context: {
				companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
			},
			signal: cancellation.signal,
		},
		(operations) => operations.invoke("query:messages.page", { first: 1 }),
	);
	cancellation.abort(reason);
	releaseResolution();
	await expect(pending).rejects.toBe(reason);
	await app.close({ deadlineAt: Date.now() + 2_000 });
});

test("refuses a late result from a handler that ignores deadline cancellation", async () => {
	const events: unknown[] = [];
	const { app, releases } = await createHoldingRuntime({
		ignoreAbort: true,
		events: (event) => events.push(event),
	});
	const pending = app.execution(
		{
			principal: principal.anonymous(),
			context: {
				companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
			},
			deadline: Date.now() + 1,
		},
		(operations) => operations.invoke("query:messages.page", { first: 1 }),
	);
	while (releases.length < 1) await Bun.sleep(0);
	await Bun.sleep(2);
	releases[0]?.();
	await expect(pending).rejects.toThrow("DEADLINE_EXCEEDED");
	expect(
		events
			.filter(
				(event): event is Extract<ExecutionEventV2, { kind: "scope.ended" }> =>
					event.kind === "scope.ended",
			)
			.map(({ end }) => [end.kind, end.outcome]),
	).toEqual([
		["query", "deadline"],
		["execution", "deadline"],
	]);
	expect(
		events
			.filter(
				(event): event is Extract<ExecutionEventV2, { kind: "scope.event" }> =>
					event.kind === "scope.event" && event.scopeKind === "execution",
			)
			.map(({ observationEvent }) => observationEvent.kind),
	).toEqual(["context.completed", "execution.deadline_exceeded"]);
	await app.close({ deadlineAt: Date.now() + 2_000 });
});

test("enforces 64 active roots per Principal across the shared admission gate", async () => {
	const { app, releases } = await createHoldingRuntime();
	const firstPrincipal = principal.user({
		id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
	});
	const secondPrincipal = principal.user({
		id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a5",
	});
	const context = {
		companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
	};
	const roots = Array.from({ length: 64 }, () =>
		app.execution({ principal: firstPrincipal, context }, (operations) =>
			operations.invoke("query:messages.page", { first: 1 }),
		),
	);
	while (releases.length < 64) await Bun.sleep(0);
	await expect(
		app.execution({ principal: firstPrincipal, context }, (operations) =>
			operations.invoke("query:messages.page", { first: 1 }),
		),
	).rejects.toThrow("RESOURCE_LIMIT");
	let workerAroundCalls = 0;
	let workerUseCalls = 0;
	expect(
		await app.workerExecution(
			{ principal: firstPrincipal, context },
			async (_observation, proceed) => {
				workerAroundCalls += 1;
				try {
					await proceed();
				} catch (error) {
					expect(error).toMatchObject({ code: "RESOURCE_LIMIT" });
					return "settled-admission-failure";
				}
				throw new Error("saturated worker root was admitted");
			},
			async () => {
				workerUseCalls += 1;
				return "unreachable";
			},
		),
	).toBe("settled-admission-failure");
	expect(workerAroundCalls).toBe(1);
	expect(workerUseCalls).toBe(0);
	const independent = app.execution(
		{ principal: secondPrincipal, context },
		(operations) => operations.invoke("query:messages.page", { first: 1 }),
	);
	while (releases.length < 65) await Bun.sleep(0);
	expect(releases).toHaveLength(65);
	for (const release of releases) release();
	await Promise.all([...roots, independent]);
	await app.close({ deadlineAt: Date.now() + 2_000 });
});

test("bounds drain, aborts the remaining root and refuses new work", async () => {
	const events: unknown[] = [];
	const { app, releases } = await createHoldingRuntime({
		drainMilliseconds: 1,
		events: (event) => events.push(event),
	});
	const user = principal.user({
		id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
	});
	const context = {
		companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
	};
	const held = app.execution({ principal: user, context }, (operations) =>
		operations.invoke("query:messages.page", { first: 1 }),
	);
	while (releases.length < 1) await Bun.sleep(0);
	const closing = app.close({ deadlineAt: Date.now() + 1 });
	await expect(
		app.execution({ principal: user, context }, (operations) =>
			operations.invoke("query:messages.page", { first: 1 }),
		),
	).rejects.toThrow("RUNTIME_UNAVAILABLE");
	await expect(held).rejects.toThrow("Runtime draining");
	await closing;
	await app.close({ deadlineAt: Date.now() + 2_000 });
	expect(
		events
			.filter(
				(event): event is Extract<ExecutionEventV2, { kind: "scope.ended" }> =>
					event.kind === "scope.ended",
			)
			.map(({ end }) => [end.kind, end.outcome]),
	).toEqual([
		["query", "cancelled"],
		["runtime", "deadline"],
		["execution", "cancelled"],
	]);
	expect(
		events
			.filter(
				(event): event is Extract<ExecutionEventV2, { kind: "scope.event" }> =>
					event.kind === "scope.event" && event.scopeKind === "execution",
			)
			.map(({ observationEvent }) => observationEvent.kind),
	).toEqual(["context.completed", "execution.cancelled"]);
});

test("shares the first absolute close deadline and does not restart it for stuck phases", async () => {
	const coordinatorDeadlines: number[] = [];
	const events: unknown[] = [];
	const { app, releases } = await createHoldingRuntime({
		coordinatorDeadlines,
		events: (event) => events.push(event),
		holdCoordinatorDrain: true,
		ignoreAbort: true,
	});
	const context = {
		companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
	};
	const held = app.execution(
		{ principal: principal.anonymous(), context },
		(operations) => operations.invoke("query:messages.page", { first: 1 }),
	);
	const heldOutcome = held.catch((error: unknown) => error);
	while (releases.length < 1) await Bun.sleep(0);
	const startedAt = Date.now();
	const deadlineAt = startedAt + 25;
	const mutableShutdown = { deadlineAt };
	const closing = app.close(mutableShutdown);
	mutableShutdown.deadlineAt += 30_000;
	const repeated = app.close({ deadlineAt: deadlineAt + 30_000 });
	expect(repeated).toBe(closing);
	await closing;
	expect(Date.now() - startedAt).toBeLessThan(100);
	expect(coordinatorDeadlines).toEqual([deadlineAt]);
	const eventsAtClose = events.length;

	releases[0]?.();
	await expect(heldOutcome).resolves.toMatchObject({ name: "AbortError" });
	expect(events.length).toBeGreaterThan(eventsAtClose);
	expect(
		events
			.filter(
				(event): event is Extract<ExecutionEventV2, { kind: "scope.ended" }> =>
					event.kind === "scope.ended",
			)
			.map(({ end }) => [end.kind, end.outcome]),
	).toEqual([
		["runtime", "deadline"],
		["query", "cancelled"],
		["execution", "cancelled"],
	]);
});
