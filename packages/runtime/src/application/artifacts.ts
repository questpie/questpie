import { decodeRuntimeCodecDescriptor, type RuntimeCodec } from "../codec";
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

type RuntimeBuildV1 = Readonly<{
	format: "questpie.runtime-build";
	version: 1;
	application: string;
	runtimeAbi: string;
	internalProtocol: string;
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
	committedMigrationsDigest: string;
	migrationHead: string | null;
	serverBundleDigest: string;
	runtimeExecutablesDigest: string;
	runtimeGraphDigest: string;
	wireDigest: string;
	later: Readonly<{
		changeLedgerDigest: null;
		resumeDigest: null;
		durableCompatibilityDigest: null;
		reactionDigest: null;
	}>;
	executableSlots: readonly string[];
	slots: readonly Readonly<{
		identity: string;
		kind: "context" | "query" | "service";
		slot: "create" | "dispose" | "handler" | "resolve";
		runtimeGraphDigest: string;
		bundleExport: string;
	}>[];
	inventory: readonly Readonly<{ path: string; digest: string }>[];
	digest: string;
}>;

type OperationWireContractV1 = Readonly<{
	format: "questpie.operation-wire";
	version: 1;
	application: string;
	path: string;
	mediaType: string;
	protocol: Readonly<{ name: "questpie.operation"; version: 1 }>;
	requestKeys: readonly string[];
	responseKeys: Readonly<Record<string, readonly string[]>>;
	operations: readonly Readonly<{
		identity: string;
		input: RuntimeCodec;
		output: RuntimeCodec;
		declaredErrors: Readonly<Record<string, unknown>>;
	}>[];
	failures: readonly string[];
	limits: Readonly<{ requestBytes: number; responseBytes: number }>;
	principalSource: "ingressOutsideBody";
	mutationAutomaticRetry: false;
	clientContractDigest: string;
	digest: string;
}>;

export type RuntimeArtifactsV1 = Readonly<{
	runtimeBuild: RuntimeBuildV1;
	runtimeExecutables: RuntimeExecutablesV1;
	wireContract: OperationWireContractV1;
}>;

function decodeWire(value: unknown): OperationWireContractV1 {
	const wire = record(value, "wire contract");
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
			"digest",
		],
		"wire contract",
	);
	if (
		wire.format !== "questpie.operation-wire" ||
		wire.version !== 1 ||
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
	const operations = wire.operations.map((raw, index) => {
		const operation = record(raw, `wire operation ${index}`);
		exact(
			operation,
			["identity", "input", "output", "declaredErrors"],
			`wire operation ${index}`,
		);
		const declaredErrors = record(
			operation.declaredErrors,
			`wire operation ${index} declared errors`,
		);
		return Object.freeze({
			identity: string(operation.identity, `wire operation ${index} identity`),
			input: decodeRuntimeCodecDescriptor(
				operation.input,
				`$wire.operations[${index}].input`,
			),
			output: decodeRuntimeCodecDescriptor(
				operation.output,
				`$wire.operations[${index}].output`,
			),
			declaredErrors: Object.freeze({ ...declaredErrors }),
		});
	});
	const operationIds = operations.map((operation) => operation.identity);
	if (
		new Set(operationIds).size !== operationIds.length ||
		operationIds.some(
			(identity, index) => identity !== [...operationIds].sort()[index],
		)
	)
		fail("wire operations must be unique and sorted");
	const digest = digestValue(wire.digest, "wire digest");
	const { digest: _digest, ...unsigned } = wire;
	if (artifactDigest("questpie-operation-wire-v1", unsigned) !== digest)
		fail("wire digest does not match");
	return Object.freeze({
		...wire,
		operations: Object.freeze(operations),
	}) as OperationWireContractV1;
}

function decodeBuild(value: unknown): RuntimeBuildV1 {
	const build = record(value, "runtime build");
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
			"committedMigrationsDigest",
			"migrationHead",
			"serverBundleDigest",
			"runtimeExecutablesDigest",
			"runtimeGraphDigest",
			"wireDigest",
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
		"serverBundleDigest",
		"runtimeExecutablesDigest",
		"runtimeGraphDigest",
		"wireDigest",
		"digest",
	] as const)
		digestValue(build[key], key);
	for (const key of [
		"policyProjectionDigest",
		"queryProjectionDigest",
		"postgresQueryPlansDigest",
	] as const)
		if (build[key] !== null) digestValue(build[key], key);
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
	if (Object.values(later).some((item) => item !== null))
		fail("later compatibility must be absent");
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
	if (compiler.buildInputDigest !== inventoryDigests.get("build-input.json"))
		fail(
			"compiler buildInputDigest does not match inventory path build-input.json",
		);
	for (const key of ["application", "runtimeAbi", "internalProtocol"] as const)
		string(build[key], key);
	if (build.migrationHead !== null)
		string(build.migrationHead, "migrationHead");
	const { digest: _digest, ...unsigned } = build;
	if (artifactDigest("questpie-runtime-build-v1", unsigned) !== build.digest)
		fail("Runtime Build digest does not match");
	return Object.freeze(build) as RuntimeBuildV1;
}

export function decodeRuntimeArtifacts(value: unknown): RuntimeArtifactsV1 {
	const envelope = record(value, "artifact envelope");
	exact(
		envelope,
		["runtimeBuild", "runtimeExecutables", "wireContract"],
		"artifact envelope",
	);
	const runtimeBuild = decodeBuild(envelope.runtimeBuild);
	const runtimeExecutables = decodeRuntimeExecutables(
		envelope.runtimeExecutables,
	);
	const wireContract = decodeWire(envelope.wireContract);
	if (
		artifactDigest("questpie-runtime-executables-v1", runtimeExecutables) !==
		runtimeBuild.runtimeExecutablesDigest
	)
		fail("runtime executable digest does not match");
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
	return Object.freeze({ runtimeBuild, runtimeExecutables, wireContract });
}
