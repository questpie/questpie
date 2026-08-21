import { decodeRuntimeCodecDescriptor } from "../codec";
import type {
	RuntimeDeclaredErrorContract,
	RuntimeOperationContract,
} from "../operation";
import {
	exactRuntimeArtifactKeys as exact,
	failRuntimeArtifact as fail,
	runtimeArtifactDigest as artifactDigest,
	runtimeArtifactDigestValue as digestValue,
	runtimeArtifactRecord as record,
	runtimeArtifactString as string,
} from "./artifact-protocol";
import {
	decodeRuntimeExecutables,
	type RuntimeExecutablesV1,
} from "./executable-artifact";
import { validateOperationWireV2 } from "./wire-v2-artifact";

type RuntimeBuildV1 = Readonly<{
	format: "questpie.runtime-build";
	version: 1;
	application: string;
	runtimeAbi: "questpie.runtime.v1";
	internalProtocol:
		| "questpie.internal.v2"
		| "questpie.internal.v3"
		| "questpie.internal.v4"
		| "questpie.internal.v5";
	compiler: Readonly<{
		version: string;
		bunVersion: string;
		buildInputDigest: string;
		executableFormat: string;
	}>;
	compilerRuntimeBuildDigest: string;
	manifestDigest: string;
	appContractDigest: string;
	clientContractDigest: string;
	packageInventoryDigest: string;
	schemaProjectionDigest: string;
	policyProjectionDigest: string | null;
	queryProjectionDigest: string | null;
	postgresQueryPlansDigest: string | null;
	postgresContextBootstrapPlansDigest: string;
	committedMigrationsDigest: string;
	migrationHead: string | null;
	schemaFingerprint: string;
	serverBundleDigest: string;
	runtimeExecutablesDigest: string;
	operationContractsDigest: string;
	runtimeGraphDigest: string;
	wireDigest: string;
	realtimeWireDigest: string | null;
	later: Readonly<{
		changeLedgerDigest: string | null;
		resumeDigest: string | null;
		durableCompatibilityDigest: string | null;
		reactionDigest: string | null;
	}>;
	executableSlots: readonly string[];
	slots: readonly Readonly<{
		identity: string;
		kind: "context" | "mutation" | "query" | "reaction" | "service";
		slot: "create" | "dispose" | "handler" | "resolve";
		runtimeGraphDigest: string;
		bundleExport: string;
	}>[];
	inventory: readonly Readonly<{ path: string; digest: string }>[];
	digest: string;
}>;

type OperationWireContractBase = Readonly<{
	format: "questpie.operation-wire";
	version: 1 | 2;
	application: string;
	path: string;
	mediaType: string;
	protocol: Readonly<{ name: "questpie.operation"; version: 1 }>;
	requestKeys: readonly string[];
	responseKeys: Readonly<Record<string, readonly string[]>>;
	operations: readonly RuntimeOperationContract[];
	failures: readonly string[];
	limits: Readonly<{ requestBytes: number; responseBytes: number }>;
	principalSource: "ingressOutsideBody";
	mutationAutomaticRetry: false;
	clientContractDigest: string;
	digest: string;
}>;

type OperationWireContractV1 = OperationWireContractBase &
	Readonly<{ version: 1 }>;

type OperationWireContractV2 = OperationWireContractBase &
	Readonly<{
		version: 2;
		compatibility: Readonly<{
			clientContractDigest: string;
			wireV1Digest: string;
		}>;
	}>;

type OperationWireContract = OperationWireContractV1 | OperationWireContractV2;

export type OperationContractsV1 = Readonly<{
	format: "questpie.operation-contracts";
	version: 1;
	operations: readonly RuntimeOperationContract[];
}>;

export type RuntimeArtifactsV1 = Readonly<{
	runtimeBuild: RuntimeBuildV1;
	runtimeExecutables: RuntimeExecutablesV1;
	operationContracts: OperationContractsV1;
	wireContract: OperationWireContract;
}>;

/**
 * Every directly invocable Operation carries its codecs here, including the
 * server-only ones the network wire never exposes.
 */
function decodeOperationContracts(value: unknown): OperationContractsV1 {
	const artifact = record(value, "operation contracts");
	exact(artifact, ["format", "version", "operations"], "operation contracts");
	if (
		artifact.format !== "questpie.operation-contracts" ||
		artifact.version !== 1 ||
		!Array.isArray(artifact.operations)
	)
		fail("operation contracts artifact is invalid");
	const operations = artifact.operations.map((operation, index) =>
		decodeOperationWireContract(operation, index, true),
	);
	const identities = operations.map(({ identity }) => identity);
	if (
		new Set(identities).size !== identities.length ||
		identities.some(
			(identity, index) => index > 0 && identity <= identities[index - 1]!,
		)
	)
		fail("operation contracts must be unique and identity-sorted");
	return Object.freeze({
		format: "questpie.operation-contracts" as const,
		version: 1 as const,
		operations: Object.freeze(operations),
	});
}

function decodeOperationWireContract(
	value: unknown,
	index: number,
	direct = false,
): RuntimeOperationContract {
	const operation = record(value, `wire operation ${index}`);
	const identity = string(
		operation.identity,
		`wire operation ${index} identity`,
	);
	const carriesAdmission = direct && identity.startsWith("mutation:");
	exact(
		operation,
		[
			"identity",
			"input",
			"output",
			"declaredErrors",
			...(carriesAdmission ? ["admission"] : []),
		],
		`wire operation ${index}`,
	);
	const admission = operation.admission;
	if (
		carriesAdmission &&
		!(["authenticated", "public", "system"] as const).includes(
			admission as "authenticated" | "public" | "system",
		)
	)
		fail(`wire operation ${index} admission is invalid`);
	const rawDeclaredErrors = record(
		operation.declaredErrors,
		`wire operation ${index} declared errors`,
	);
	const declaredErrors: RuntimeDeclaredErrorContract[] = Object.entries(
		rawDeclaredErrors,
	)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([key, raw]) => {
			const path = `wire operation ${index} declared error ${key}`;
			const declaredError = record(raw, path);
			exact(declaredError, ["code", "status", "payload"], path);
			const status = declaredError.status;
			if (
				typeof status !== "number" ||
				!Number.isInteger(status) ||
				status < 400 ||
				status > 599
			)
				fail(`${path} status is invalid`);
			return Object.freeze({
				key: string(key, `${path} key`),
				code: string(declaredError.code, `${path} code`),
				status,
				payload:
					declaredError.payload === null
						? null
						: decodeRuntimeCodecDescriptor(
								declaredError.payload,
								`$wire.operations[${index}].declaredErrors.${key}.payload`,
							),
			});
		});
	if (
		new Set(declaredErrors.map(({ code }) => code)).size !==
		declaredErrors.length
	)
		fail(`wire operation ${index} declared error codes must be unique`);
	return Object.freeze({
		...(carriesAdmission
			? { admission: admission as "authenticated" | "public" | "system" }
			: {}),
		identity,
		input: decodeRuntimeCodecDescriptor(
			operation.input,
			`$wire.operations[${index}].input`,
		),
		output: decodeRuntimeCodecDescriptor(
			operation.output,
			`$wire.operations[${index}].output`,
		),
		declaredErrors: Object.freeze(declaredErrors),
	});
}

function decodeWire(value: unknown): OperationWireContract {
	const wire = record(value, "wire contract");
	const isV2 = wire.version === 2;
	exact(
		wire,
		[
			"format",
			"version",
			"application",
			"path",
			"mediaType",
			"protocol",
			"requestKeys",
			"responseKeys",
			"operations",
			"failures",
			"limits",
			"principalSource",
			"mutationAutomaticRetry",
			"clientContractDigest",
			...(isV2
				? [
						"failureDetails",
						"resultKinds",
						"callIdentity",
						"transactionIdentity",
						"committedResultUnavailable",
						"compatibility",
					]
				: []),
			"digest",
		],
		"wire contract",
	);
	if (
		wire.format !== "questpie.operation-wire" ||
		(wire.version !== 1 && wire.version !== 2) ||
		typeof wire.application !== "string" ||
		wire.path !== "/_questpie/operation" ||
		wire.mediaType !== "application/vnd.questpie.operation+json;version=1" ||
		wire.principalSource !== "ingressOutsideBody" ||
		wire.mutationAutomaticRetry !== false ||
		!Array.isArray(wire.requestKeys) ||
		!Array.isArray(wire.operations) ||
		!Array.isArray(wire.failures)
	)
		fail("wire contract is invalid");
	const protocol = record(wire.protocol, "wire protocol");
	exact(protocol, ["name", "version"], "wire protocol");
	if (protocol.name !== "questpie.operation" || protocol.version !== 1)
		fail("wire protocol is invalid");
	const limits = record(wire.limits, "wire limits");
	exact(limits, ["requestBytes", "responseBytes"], "wire limits");
	if (
		!Number.isSafeInteger(limits.requestBytes) ||
		(limits.requestBytes as number) <= 0 ||
		!Number.isSafeInteger(limits.responseBytes) ||
		(limits.responseBytes as number) <= 0
	)
		fail("wire limits are invalid");
	const expectedRequestKeys = [
		"application",
		"callId",
		"clientContractDigest",
		"context",
		"input",
		"operation",
		"protocol",
		"timeoutMilliseconds",
		"wireDigest",
	];
	if (JSON.stringify(wire.requestKeys) !== JSON.stringify(expectedRequestKeys))
		fail("wire request keys are invalid");
	const responseKeys = record(wire.responseKeys, "wire response keys");
	exact(
		responseKeys,
		["declaredError", "failure", "rejection", "result"],
		"wire response keys",
	);
	const responseShape = {
		declaredError: ["callId", "error", "kind", "operation", "protocol"],
		failure: ["callId", "error", "kind", "operation", "protocol"],
		rejection: ["error", "kind"],
		result: ["callId", "kind", "operation", "payload", "protocol"],
	};
	for (const [key, expected] of Object.entries(responseShape))
		if (JSON.stringify(responseKeys[key]) !== JSON.stringify(expected))
			fail("wire response keys are invalid");
	const operations = wire.operations.map((operation, index) =>
		decodeOperationWireContract(operation, index),
	);
	const operationIds = operations.map((operation) => operation.identity);
	if (
		new Set(operationIds).size !== operationIds.length ||
		operationIds.some(
			(identity, index) => identity !== [...operationIds].sort()[index],
		)
	)
		fail("wire operations must be unique and sorted");
	if (isV2) validateOperationWireV2(wire);
	else if (
		JSON.stringify(wire.failures) !==
		JSON.stringify([
			"APPLICATION_MISMATCH",
			"CLIENT_OUTDATED",
			"DEADLINE_EXCEEDED",
			"INTERNAL",
			"NOT_FOUND",
			"PROTOCOL_UNSUPPORTED",
			"RESOURCE_LIMIT",
			"RUNTIME_UNAVAILABLE",
		])
	)
		fail("wire failures are invalid");
	const digest = digestValue(wire.digest, "wire digest");
	const { digest: _digest, ...unsigned } = wire;
	if (
		artifactDigest(
			isV2 ? "questpie-operation-wire-v2" : "questpie-operation-wire-v1",
			unsigned,
		) !== digest
	)
		fail("wire digest does not match");
	return Object.freeze({
		...wire,
		operations: Object.freeze(operations),
	}) as OperationWireContract;
}

function decodeBuild(value: unknown): RuntimeBuildV1 {
	const build = record(value, "runtime build");
	const internalProtocol = build.internalProtocol;
	const durable =
		internalProtocol === "questpie.internal.v4" ||
		internalProtocol === "questpie.internal.v5";
	const v3 = internalProtocol === "questpie.internal.v3" || durable;
	exact(
		build,
		[
			"format",
			"version",
			"application",
			"runtimeAbi",
			"internalProtocol",
			"compiler",
			"compilerRuntimeBuildDigest",
			"manifestDigest",
			"appContractDigest",
			"clientContractDigest",
			"packageInventoryDigest",
			"schemaProjectionDigest",
			"policyProjectionDigest",
			"queryProjectionDigest",
			"postgresQueryPlansDigest",
			"postgresContextBootstrapPlansDigest",
			"committedMigrationsDigest",
			"migrationHead",
			"schemaFingerprint",
			"serverBundleDigest",
			"runtimeExecutablesDigest",
			"operationContractsDigest",
			"runtimeGraphDigest",
			"wireDigest",
			...(v3 ? ["realtimeWireDigest"] : []),
			"later",
			"executableSlots",
			"slots",
			"inventory",
			"digest",
		],
		"runtime build",
	);
	if (
		build.format !== "questpie.runtime-build" ||
		build.version !== 1 ||
		!Array.isArray(build.executableSlots) ||
		!Array.isArray(build.slots) ||
		!Array.isArray(build.inventory)
	)
		fail("runtime build is invalid");
	for (const key of [
		"manifestDigest",
		"appContractDigest",
		"clientContractDigest",
		"packageInventoryDigest",
		"schemaProjectionDigest",
		"compilerRuntimeBuildDigest",
		"committedMigrationsDigest",
		"schemaFingerprint",
		"serverBundleDigest",
		"runtimeExecutablesDigest",
		"operationContractsDigest",
		"runtimeGraphDigest",
		"wireDigest",
		"digest",
	] as const)
		digestValue(build[key], key);
	if (v3) digestValue(build.realtimeWireDigest, "realtimeWireDigest");
	for (const key of [
		"policyProjectionDigest",
		"queryProjectionDigest",
		"postgresQueryPlansDigest",
	] as const)
		if (build[key] !== null) digestValue(build[key], key);
	digestValue(
		build.postgresContextBootstrapPlansDigest,
		"postgresContextBootstrapPlansDigest",
	);
	const later = record(build.later, "later compatibility");
	exact(
		later,
		[
			"changeLedgerDigest",
			"resumeDigest",
			"durableCompatibilityDigest",
			"reactionDigest",
		],
		"later compatibility",
	);
	if (v3) {
		digestValue(later.changeLedgerDigest, "changeLedgerDigest");
		digestValue(later.resumeDigest, "resumeDigest");
	} else if (later.changeLedgerDigest !== null || later.resumeDigest !== null)
		fail("Live Query digests require internal protocol v3");
	if (later.durableCompatibilityDigest !== null) {
		if (!durable)
			fail("durableCompatibilityDigest requires internal protocol v4");
		digestValue(later.durableCompatibilityDigest, "durableCompatibilityDigest");
	}
	if (later.reactionDigest !== null)
		digestValue(later.reactionDigest, "reactionDigest");
	const compiler = record(build.compiler, "compiler");
	exact(
		compiler,
		["version", "bunVersion", "buildInputDigest", "executableFormat"],
		"compiler",
	);
	for (const key of ["version", "bunVersion", "executableFormat"])
		string(compiler[key], `compiler ${key}`);
	digestValue(compiler.buildInputDigest, "compiler buildInputDigest");
	if (
		artifactDigest("questpie-compiler-runtime-build-v1", compiler) !==
		build.compilerRuntimeBuildDigest
	)
		fail("compiler Runtime Build digest does not match");
	const executableSlots = build.executableSlots.map((item, index) =>
		string(item, `executable slot ${index}`),
	);
	if (
		new Set(executableSlots).size !== executableSlots.length ||
		executableSlots.some(
			(identity, index) => identity !== [...executableSlots].sort()[index],
		)
	)
		fail("build executable slots must be unique and sorted");
	const slots = build.slots.map((raw, index) => {
		const slot = record(raw, `build slot ${index}`);
		exact(
			slot,
			["identity", "kind", "slot", "runtimeGraphDigest", "bundleExport"],
			`build slot ${index}`,
		);
		return {
			identity: string(slot.identity, `build slot ${index} identity`),
			kind: string(slot.kind, `build slot ${index} kind`),
			slot: string(slot.slot, `build slot ${index} slot`),
			runtimeGraphDigest: digestValue(
				slot.runtimeGraphDigest,
				`build slot ${index} graph`,
			),
			bundleExport: string(
				slot.bundleExport,
				`build slot ${index} bundle export`,
			),
		};
	});
	if (
		slots.length !== executableSlots.length ||
		slots.some(
			(slot, index) =>
				`${slot.identity}#${slot.slot}` !== executableSlots[index],
		)
	)
		fail("build slot inventory does not match");
	if (
		artifactDigest(
			"questpie-runtime-graphs-v1",
			slots.map(({ identity, slot, runtimeGraphDigest: graph }) => ({
				identity,
				slot,
				runtimeGraphDigest: graph,
			})),
		) !== build.runtimeGraphDigest
	)
		fail("Runtime graph digest does not match");
	for (const [index, raw] of build.inventory.entries()) {
		const item = record(raw, `inventory ${index}`);
		exact(item, ["path", "digest"], `inventory ${index}`);
		string(item.path, `inventory ${index} path`);
		digestValue(item.digest, `inventory ${index} digest`);
	}
	const inventory = build.inventory as readonly Readonly<{
		path: string;
		digest: string;
	}>[];
	if (
		new Set(inventory.map((item) => item.path)).size !== inventory.length ||
		inventory.some(
			(item, index) =>
				item.path !==
				[...inventory].sort((left, right) =>
					left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
				)[index]?.path,
		)
	)
		fail("runtime inventory must be unique and sorted");
	const inventoryDigests = new Map(
		inventory.map((item) => [item.path, item.digest]),
	);
	for (const [field, path] of [
		["manifestDigest", "manifest.json"],
		["appContractDigest", "app.ts"],
		["packageInventoryDigest", "internal/package-inventories.json"],
		["schemaProjectionDigest", "schema-projection.json"],
		["policyProjectionDigest", "policy-projection.json"],
		["queryProjectionDigest", "query-projection.json"],
		["postgresQueryPlansDigest", "postgres-query-plans.json"],
		["committedMigrationsDigest", "committed-migrations.json"],
		["serverBundleDigest", "internal/application.js"],
	] as const) {
		const expected = build[field];
		const actual = inventoryDigests.get(path) ?? null;
		if (expected !== actual)
			fail(`${field} does not match inventory path ${path}`);
	}
	if (
		(later.reactionDigest === null) !==
		!inventoryDigests.has("reaction-projection.json")
	)
		fail("reactionDigest does not match reaction-projection inventory");
	if (
		(later.durableCompatibilityDigest === null) !==
		!inventoryDigests.has("durable-kernel.json")
	)
		fail("durableCompatibilityDigest does not match durable-kernel inventory");
	if (compiler.buildInputDigest !== inventoryDigests.get("build-input.json"))
		fail(
			"compiler buildInputDigest does not match inventory path build-input.json",
		);
	for (const key of ["application", "runtimeAbi", "internalProtocol"] as const)
		string(build[key], key);
	if (build.runtimeAbi !== "questpie.runtime.v1")
		fail("unsupported Runtime ABI");
	if (!/^questpie\.internal\.v[2-5]$/.test(internalProtocol as string))
		fail("unsupported internal protocol");
	if (build.migrationHead !== null)
		string(build.migrationHead, "migrationHead");
	const { digest: _digest, ...unsigned } = build;
	if (artifactDigest("questpie-runtime-build-v1", unsigned) !== build.digest)
		fail("Runtime Build digest does not match");
	return Object.freeze({
		...build,
		realtimeWireDigest: v3
			? digestValue(build.realtimeWireDigest, "realtimeWireDigest")
			: null,
	}) as RuntimeBuildV1;
}

export function decodeRuntimeArtifacts(value: unknown): RuntimeArtifactsV1 {
	const envelope = record(value, "artifact envelope");
	exact(
		envelope,
		[
			"runtimeBuild",
			"runtimeExecutables",
			"operationContracts",
			"wireContract",
		],
		"artifact envelope",
	);
	const runtimeBuild = decodeBuild(envelope.runtimeBuild);
	const runtimeExecutables = decodeRuntimeExecutables(
		envelope.runtimeExecutables,
	);
	const operationContracts = decodeOperationContracts(
		envelope.operationContracts,
	);
	const wireContract = decodeWire(envelope.wireContract);
	if (
		artifactDigest("questpie-runtime-executables-v1", runtimeExecutables) !==
		runtimeBuild.runtimeExecutablesDigest
	)
		fail("runtime executable digest does not match");
	if (
		!wireContract.operations.every((operation) =>
			operationContracts.operations.some(
				(candidate) => candidate.identity === operation.identity,
			),
		)
	)
		fail("wire operations are not covered by the operation contracts");
	if (
		wireContract.digest !== runtimeBuild.wireDigest ||
		wireContract.application !== runtimeBuild.application ||
		wireContract.clientContractDigest !== runtimeBuild.clientContractDigest
	)
		fail("wire binding does not match");
	if (
		runtimeBuild.executableSlots.length !== runtimeExecutables.slots.length ||
		runtimeBuild.executableSlots.some(
			(identity, index) =>
				identity !==
				`${runtimeExecutables.slots[index]?.identity}#${runtimeExecutables.slots[index]?.slot}`,
		)
	)
		fail("runtime executable inventory does not match");
	if (
		runtimeBuild.slots.some((slot, index) => {
			const executable = runtimeExecutables.slots[index];
			return (
				!executable ||
				slot.identity !== executable.identity ||
				slot.kind !== executable.kind ||
				slot.slot !== executable.slot ||
				slot.runtimeGraphDigest !== executable.runtimeGraphDigest ||
				slot.bundleExport !== executable.bundleExport
			);
		})
	)
		fail("Runtime Build slots do not match executable inventory");
	return Object.freeze({
		runtimeBuild,
		runtimeExecutables,
		operationContracts,
		wireContract,
	});
}
