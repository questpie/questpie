import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { codec, defineContext, defineService, principal } from "questpie";

import { createRuntimeApplication } from "../../packages/runtime/src";
import {
	bindIngressPrincipal,
	readIngressPrincipal,
} from "../../packages/runtime/src/operation/ingress";

const sha = (character: string) => character.repeat(64);

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

function runtimeArtifacts(additionalSlots: readonly unknown[] = []) {
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
	const unsignedWire = {
		format: "questpie.operation-wire",
		version: 1,
		application: "application:collaboration",
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
			declaredError: ["callId", "error", "kind", "operation", "protocol"],
			result: ["callId", "kind", "operation", "payload", "protocol"],
			failure: ["callId", "error", "kind", "operation", "protocol"],
			rejection: ["error", "kind"],
		},
		operations: [
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
		],
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
		clientContractDigest: sha("7"),
	} as const;
	const wireContract = {
		...unsignedWire,
		digest: digest("questpie-operation-wire-v1", unsignedWire),
	};
	const artifactFiles = {
		"app.ts": "export type App = unknown;\n",
		"build-input.json": '{"format":"questpie.build-input"}\n',
		"committed-migrations.json": "[]\n",
		"internal/application.js": "export const runtime = true;\n",
		"internal/package-inventories.json": "[]\n",
		"internal/server.ts": "export const executable = true;\n",
		"manifest.json": '{"format":"questpie.manifest"}\n',
		"policy-projection.json": "{}\n",
		"postgres-query-plans.json": "{}\n",
		"query-projection.json": "{}\n",
		"runtime-executables.json": `${JSON.stringify(runtimeExecutables)}\n`,
		"schema-projection.json": "{}\n",
		"wire-contract.json": `${JSON.stringify(wireContract)}\n`,
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
		clientContractDigest: unsignedWire.clientContractDigest,
		packageInventoryDigest: fileDigest(
			artifactFiles["internal/package-inventories.json"],
		),
		schemaProjectionDigest: fileDigest(artifactFiles["schema-projection.json"]),
		policyProjectionDigest: fileDigest(artifactFiles["policy-projection.json"]),
		queryProjectionDigest: fileDigest(artifactFiles["query-projection.json"]),
		postgresQueryPlansDigest: fileDigest(
			artifactFiles["postgres-query-plans.json"],
		),
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
		runtimeGraphDigest,
		wireDigest: wireContract.digest,
		executableSlots: slots.map((slot) => `${slot.identity}#${slot.slot}`),
		slots,
		later: {
			changeLedgerDigest: null,
			resumeDigest: null,
			durableCompatibilityDigest: null,
			reactionDigest: null,
		},
		inventory: Object.entries(artifactFiles).map(([path, bytes]) => ({
			path,
			digest: fileDigest(bytes),
		})),
	};
	return {
		artifactFiles,
		runtimeExecutables,
		wireContract,
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
		wireContract: value.wireContract,
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
				kind: "context" | "query" | "service";
				slot: "create" | "dispose" | "handler" | "resolve";
				execute?: unknown;
				definition: Readonly<Record<string, unknown>>;
			}>;
			const implementation =
				binding.kind === "query"
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
				bootstrap: { get: async () => null },
				project: ({ facts }) => ({ signal: facts.signal }),
				resolvePrincipal: async () => principal.anonymous(),
			},
		}),
	).rejects.toThrow("runtime build has invalid keys");
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
				bootstrap: { get: async () => null },
				project: ({ facts }) => ({ signal: facts.signal }),
				resolvePrincipal: async () => principal.anonymous(),
			},
		}),
	).rejects.toThrow("executable binding does not match");
	expect({ handlerCalls, resolves }).toEqual({ handlerCalls: 0, resolves: 0 });
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
		bootstrap: { get: async () => null },
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
	expect({ readiness, resolves, handlerCalls }).toEqual({
		readiness: 0,
		resolves: 0,
		handlerCalls: 0,
	});
});

test("runs one valid build through the direct operation engine", async () => {
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
			return { count: (input as Readonly<{ first: number }>).first };
		}),
	];
	const program = {
		services: [],
		context,
		bootstrap: { get: async () => null },
		project: ({ facts }: { facts: { signal: AbortSignal } }) => ({
			signal: facts.signal,
		}),
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
	await app.close();
});

test("rejects missing, duplicate, stale, wrong-kind and cross-build bindings", async () => {
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
	const cases: readonly Readonly<{
		name: string;
		artifacts: unknown;
		bindings: unknown;
		runtimeBuildDigest?: string;
	}>[] = [
		{
			name: "missing",
			artifacts: runtimeArtifacts(),
			bindings: [contextBinding],
		},
		{
			name: "duplicate",
			artifacts: runtimeArtifacts(),
			bindings: [contextBinding, queryBinding, queryBinding],
		},
		{
			name: "stale",
			artifacts: runtimeArtifacts(),
			bindings: [
				contextBinding,
				{ ...queryBinding, runtimeGraphDigest: sha("0") },
			],
		},
		{
			name: "wrong-kind",
			artifacts: runtimeArtifacts(),
			bindings: [contextBinding, { ...queryBinding, kind: "service" }],
		},
		{
			name: "cross-build",
			artifacts: runtimeArtifacts(),
			bindings: [contextBinding, queryBinding],
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
					runtimeBuildDigest:
						hostile.runtimeBuildDigest ??
						(hostile.artifacts as ReturnType<typeof runtimeArtifacts>)
							.runtimeBuild.digest,
					slots: hostile.bindings as never,
				},
				serverExports: serverExportsFor([contextBinding, queryBinding]),
				program: {
					services: [],
					context,
					bootstrap: { get: async () => null },
					project: ({ facts }) => ({ signal: facts.signal }),
					resolvePrincipal: async () => principal.anonymous(),
				},
			}),
		).rejects.toThrow();
	}
	expect({ handlerCalls, resolves }).toEqual({ handlerCalls: 0, resolves: 0 });
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
			bootstrap: { get: async () => null },
			project: ({ facts }) => ({ signal: facts.signal }),
			resolvePrincipal: async () => principal.anonymous(),
		},
	});
	await app.close();
});

test("uses one engine for direct and Fetch and rejects hostile wire before disclosure", async () => {
	let resolves = 0;
	let handlerCalls = 0;
	let principalResolutions = 0;
	let principalFailure = false;
	const events: unknown[] = [];
	const context = defineContext({
		name: "app.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => {
			resolves += 1;
			return { tenant: { id: input.companyId }, values: {} };
		},
	});
	const user = principal.user({
		id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
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
	const app = await createRuntimeApplication({
		artifacts: runtimeArtifactEnvelope(artifacts),
		artifactFiles: artifacts.artifactFiles,
		...executableBindings(artifacts, bindings),
		program: {
			services: [],
			context,
			bootstrap: { get: async () => null },
			project: ({ facts }) => ({ signal: facts.signal }),
			resolvePrincipal: async (request) => {
				principalResolutions += 1;
				if (principalFailure) throw new Error("credential detail");
				return readIngressPrincipal(request);
			},
		},
		events: (event) => {
			events.push(event);
			throw new Error("telemetry unavailable");
		},
		now: () => new Date("2026-08-15T16:00:00.000Z"),
	});
	const baseFrame = {
		application: artifacts.runtimeBuild.application,
		callId: "call:1",
		clientContractDigest: artifacts.runtimeBuild.clientContractDigest,
		context: { companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0" },
		input: { first: 2 },
		operation: "query:messages.page",
		protocol: { name: "questpie.operation", version: 1 },
		timeoutMilliseconds: null,
		wireDigest: artifacts.wireContract.digest,
	} as const;
	const send = (frame: unknown) => {
		const request = new Request("http://runtime.test/_questpie/operation", {
			method: "POST",
			headers: {
				"content-type": "application/vnd.questpie.operation+json;version=1",
			},
			body: JSON.stringify(frame),
		});
		bindIngressPrincipal(request, user);
		return app.fetch(request);
	};
	let bodyCancelled = false;
	const oversizedBody = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array(600_000));
			controller.enqueue(new Uint8Array(600_000));
		},
		cancel() {
			bodyCancelled = true;
		},
	});
	const oversized = await app.fetch(
		new Request("http://runtime.test/_questpie/operation", {
			method: "POST",
			headers: {
				"content-type": "application/vnd.questpie.operation+json;version=1",
			},
			body: oversizedBody,
			duplex: "half",
		} as RequestInit & { duplex: "half" }),
	);
	expect(await oversized.json()).toMatchObject({
		kind: "failure",
		error: { code: "RESOURCE_LIMIT" },
	});
	expect(bodyCancelled).toBe(true);

	for (const [frame, code] of [
		[{ ...baseFrame, clientContractDigest: sha("0") }, "CLIENT_OUTDATED"],
		[{ ...baseFrame, operation: "query:unknown" }, "NOT_FOUND"],
		[{ ...baseFrame, input: { first: "2" } }, "PROTOCOL_UNSUPPORTED"],
		[
			{ ...baseFrame, input: { first: 2, at: "2026-99-15T16:00:00.000Z" } },
			"PROTOCOL_UNSUPPORTED",
		],
	] as const) {
		const hostile = await send(frame);
		expect((await hostile.json()) as unknown).toMatchObject({
			kind: "failure",
			error: { code },
		});
	}
	expect({ handlerCalls, principalResolutions, resolves }).toEqual({
		handlerCalls: 0,
		principalResolutions: 0,
		resolves: 0,
	});

	const network = await send(baseFrame);
	expect(network.status).toBe(200);
	expect((await network.json()) as unknown).toMatchObject({
		kind: "result",
		operation: "query:messages.page",
		payload: { count: 2 },
	});
	const direct = await app.execution(
		{ principal: user, context: baseFrame.context },
		(operations) => operations.invoke("query:messages.page", { first: 2 }),
	);
	expect(direct).toEqual({ count: 2 });
	expect({ handlerCalls, principalResolutions, resolves }).toEqual({
		handlerCalls: 2,
		principalResolutions: 1,
		resolves: 2,
	});

	principalFailure = true;
	const failedPrincipal = await send({ ...baseFrame, callId: "call:2" });
	expect((await failedPrincipal.json()) as unknown).toMatchObject({
		kind: "failure",
		error: { code: "INTERNAL" },
	});
	expect(handlerCalls).toBe(2);
	await app.close();
	const eventBytes = JSON.stringify(events);
	expect(eventBytes).not.toContain(baseFrame.context.companyId);
	expect(eventBytes).not.toContain('"input"');
	expect(
		events.map(
			(event) =>
				(event as Readonly<{ event: Readonly<{ kind: string }> }>).event.kind,
		),
	).toEqual([
		"ready",
		"accepted",
		"result",
		"accepted",
		"result",
		"drainStarted",
		"stopped",
	]);
});

async function createHoldingRuntime(
	input: Readonly<{
		drainMilliseconds?: number;
		events?: (event: unknown) => void;
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
			bootstrap: { get: async () => null },
			project: ({ facts }) => ({ signal: facts.signal }),
			resolvePrincipal: async () => principal.anonymous(),
		},
		drainMilliseconds: input.drainMilliseconds,
		events: input.events,
	});
	return { app, releases, artifacts };
}

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
	const request = new Request("http://runtime.test/_questpie/operation", {
		method: "POST",
		headers: {
			"content-type": "application/vnd.questpie.operation+json;version=1",
		},
		body: JSON.stringify({
			application: artifacts.runtimeBuild.application,
			callId: "call:disconnect",
			clientContractDigest: artifacts.runtimeBuild.clientContractDigest,
			context,
			input: { first: 1 },
			operation: "query:messages.page",
			protocol: { name: "questpie.operation", version: 1 },
			timeoutMilliseconds: null,
			wireDigest: artifacts.wireContract.digest,
		}),
		signal: disconnect.signal,
	});
	const pending = app.fetch(request);
	while (releases.length < 2) await Bun.sleep(0);
	disconnect.abort();
	await expect(pending).rejects.toMatchObject({ name: "AbortError" });
	await app.close();
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
		events.map(
			(event) =>
				(event as Readonly<{ event: Readonly<{ kind: string }> }>).event.kind,
		),
	).toEqual(["ready", "accepted", "failed"]);
	await app.close();
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
	const independent = app.execution(
		{ principal: secondPrincipal, context },
		(operations) => operations.invoke("query:messages.page", { first: 1 }),
	);
	while (releases.length < 65) await Bun.sleep(0);
	expect(releases).toHaveLength(65);
	for (const release of releases) release();
	await Promise.all([...roots, independent]);
	await app.close();
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
	const closing = app.close();
	await expect(
		app.execution({ principal: user, context }, (operations) =>
			operations.invoke("query:messages.page", { first: 1 }),
		),
	).rejects.toThrow("RUNTIME_UNAVAILABLE");
	await expect(held).rejects.toThrow("Runtime draining");
	await closing;
	await app.close();
	expect(
		events.map(
			(event) =>
				(event as Readonly<{ event: Readonly<{ kind: string }> }>).event.kind,
		),
	).toEqual([
		"ready",
		"accepted",
		"drainStarted",
		"drainTimedOut",
		"failed",
		"stopped",
	]);
});
