import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	actionServiceResources,
	executionServiceResources,
	normalizeActionContract,
} from "../../packages/compiler/src/action";
import { evaluateModules } from "../../packages/compiler/src/discovery";
import { projectRuntimeContract } from "../../packages/compiler/src/runtime";
import {
	renderServerOperationType,
	renderServerOperationValue,
} from "../../packages/compiler/src/server-operation-map";
import type {
	ApplicationConfiguration,
	NormalizedResource,
} from "../../packages/compiler/src/types";

const codec = (value: unknown) => value;
const actionValue = Object.freeze({
	__questpie: Object.freeze({ category: "definition", resourceKind: "action" }),
	executableSlots: Object.freeze(["handler"]),
	name: "delivery.publish",
	network: false,
	input: { kind: "object", properties: { message: { kind: "text" } } },
	output: { kind: "object", properties: { receipt: { kind: "text" } } },
	policy: {
		kind: "booleanExpression",
		operator: "authenticated",
		operands: [],
	},
	errors: {
		providerRejected: {
			kind: "operationError",
			code: "PROVIDER_REJECTED",
			status: 502,
			payload: null,
		},
	},
	limits: {
		inputBytes: 4_096,
		resultBytes: 4_096,
		durationMilliseconds: 1_000,
	},
});

test("renders nested frozen null-prototype server Operation maps", () => {
	const source = renderServerOperationValue("Action", [
		{ name: "constructor", value: "() => 'constructor'" },
		{ name: "delivery.publish", value: "() => 'published'" },
		{ name: "prototype", value: "() => 'prototype'" },
	]);
	const operations = Function(`return (${source})`)() as Readonly<
		Record<string, unknown>
	>;
	expect(Object.getPrototypeOf(operations)).toBeNull();
	expect(Object.isFrozen(operations)).toBe(true);
	expect(Object.hasOwn(operations, "constructor")).toBe(true);
	expect(Object.hasOwn(operations, "prototype")).toBe(true);
	const delivery = operations.delivery as Readonly<Record<string, unknown>>;
	expect(Object.getPrototypeOf(delivery)).toBeNull();
	expect(Object.isFrozen(delivery)).toBe(true);
	expect((operations.constructor as () => string)()).toBe("constructor");
	expect((delivery.publish as () => string)()).toBe("published");
	expect((operations.prototype as () => string)()).toBe("prototype");
	expect(
		renderServerOperationType("Action", [
			{ name: "delivery.publish", value: "Publish" },
		]),
	).toBe(
		'Readonly<{ readonly "delivery": Readonly<{ readonly "publish": Publish; }>; }>',
	);
});

test("rejects ambiguous or thenable server Operation names", () => {
	for (const members of [
		[
			{ name: "delivery", value: "Delivery" },
			{ name: "delivery.publish", value: "Publish" },
		],
		[
			{ name: "delivery.publish", value: "Publish" },
			{ name: "delivery", value: "Delivery" },
		],
		[{ name: "delivery.then", value: "Then" }],
		[{ name: "then", value: "Then" }],
	] as const)
		expect(() => renderServerOperationType("Action", members)).toThrow(
			"QP-COMPOSE-013",
		);
});

async function discoverAction(properties: string) {
	const root = await mkdtemp(join(tmpdir(), "questpie-action-discovery-"));
	try {
		const source = resolve(root, "action.ts");
		await writeFile(
			source,
			`import { defineAction } from "#questpie/app";
export const action = defineAction({
  name: "delivery.test",
  input: { kind: "text" },
  output: { kind: "text" },
  policy: { kind: "booleanExpression", operator: "authenticated", operands: [] },
  errors: {},
  limits: { inputBytes: 1, resultBytes: 1, durationMilliseconds: 1 },
  ${properties}
});\n`,
		);
		return (
			await evaluateModules({
				applicationRoot: root,
				files: [source],
				frameworkEntry: resolve(
					import.meta.dir,
					"../../packages/questpie/src/index.ts",
				),
				packages: new Map(),
			})
		)[0]?.value;
	} finally {
		await rm(root, { force: true, recursive: true });
	}
}

test("fails controlled discovery without one executable Action handler", async () => {
	for (const properties of [
		"network: false",
		"network: false, handler: undefined",
		"network: false, handler: null",
		"network: false, handler: 'not-a-function'",
	])
		await expect(discoverAction(properties)).rejects.toThrow("QP-COMPOSE-013");
});

test("defaults only omitted Action network intent and preserves invalid values", async () => {
	for (const [properties, expected] of [
		["handler: () => 'ok'", false],
		["network: false, handler: () => 'ok'", false],
		["network: true, handler: () => 'ok'", true],
	] as const) {
		const discovered = await discoverAction(properties);
		expect(discovered?.network).toBe(expected);
		expect(() =>
			normalizeActionContract(discovered ?? {}, codec),
		).not.toThrow();
	}
	for (const properties of [
		"network: 'true', handler: () => 'ok'",
		"network: 1, handler: () => 'ok'",
		"network: null, handler: () => 'ok'",
	]) {
		const discovered = await discoverAction(properties);
		expect(() => normalizeActionContract(discovered ?? {}, codec)).toThrow();
	}
});

test("materializes omitted Action network intent in controlled discovery", async () => {
	const fixture = resolve(import.meta.dir, "../../fixtures/collaboration");
	const evaluated = await evaluateModules({
		applicationRoot: fixture,
		files: [resolve(fixture, "src/delivery-action.ts")],
		frameworkEntry: resolve(
			import.meta.dir,
			"../../packages/questpie/src/index.ts",
		),
		packages: new Map(),
	});
	const action = evaluated.find(
		(candidate) => candidate.exportName === "publishDelivery",
	)?.value;
	expect(Object.keys(action ?? {}).sort()).toEqual([
		"__questpie",
		"errors",
		"executableSlots",
		"input",
		"limits",
		"name",
		"network",
		"output",
		"policy",
	]);
	expect(action?.network).toBe(false);
	expect(() => normalizeActionContract(action ?? {}, codec)).not.toThrow();
});

test("normalizes one closed direct Action contract without defaults or aliases", () => {
	expect(normalizeActionContract(actionValue, codec)).toEqual({
		format: "questpie.action-definition-contract",
		version: 1,
		name: "delivery.publish",
		input: actionValue.input,
		output: actionValue.output,
		admission: "authenticated",
		declaredErrors: {
			providerRejected: {
				code: "PROVIDER_REJECTED",
				status: 502,
				payload: null,
			},
		},
		limits: actionValue.limits,
		exposure: "server",
		executableSlots: ["handler"],
	});
	expect(
		normalizeActionContract({ ...actionValue, network: true }, codec).exposure,
	).toBe("network");
	for (const invalid of [
		{ ...actionValue, retry: true },
		{ ...actionValue, network: "true" },
		Object.fromEntries(
			Object.entries(actionValue).filter(([key]) => key !== "network"),
		),
		{ ...actionValue, limits: { ...actionValue.limits, inputBytes: 0 } },
		{
			...actionValue,
			limits: { inputBytes: 1, resultBytes: 1 },
		},
		{
			...actionValue,
			policy: { kind: "booleanExpression", operator: "exists", operands: [] },
		},
	])
		expect(() => normalizeActionContract(invalid, codec)).toThrow();
});

function service(
	name: string,
	lifetime: "application" | "execution",
	effect: "external" | "read",
	dependencies: readonly string[] = [],
): NormalizedResource {
	return {
		identity: `service:${name}`,
		kind: "service",
		name,
		contract: {
			lifetime,
			effect,
			dependencies: dependencies.map((identity) => ({ identity })),
		},
		contributions: [],
		origin: {
			logicalPath: "src/services.ts",
			exportName: name.replaceAll(".", "_"),
			packageId: null,
			span: null,
			memberSpans: {},
		},
		value: {},
	};
}

test("projects only execution-owned external Action Service closures", () => {
	const applicationRead = service("app.read", "application", "read");
	const executionRead = service("execution.read", "execution", "read");
	const eligible = service("delivery.eligible", "execution", "external", [
		executionRead.identity,
	]);
	const escaped = service("delivery.escaped", "execution", "external", [
		applicationRead.identity,
	]);
	expect(
		actionServiceResources([
			applicationRead,
			executionRead,
			eligible,
			escaped,
		]).map(({ identity }) => identity),
	).toEqual(["service:delivery.eligible"]);
	expect(
		executionServiceResources([
			applicationRead,
			executionRead,
			eligible,
			escaped,
		]).map(({ identity }) => identity),
	).toEqual([
		"service:app.read",
		"service:execution.read",
		"service:delivery.escaped",
	]);
});

test("adds the direct Action artifact while retaining client and Wire v2 bytes", () => {
	const contract = normalizeActionContract(actionValue, codec);
	const action: NormalizedResource = {
		identity: "action:delivery.publish",
		kind: "action",
		name: "delivery.publish",
		contract,
		contributions: [],
		origin: {
			logicalPath: "src/delivery-action.ts",
			exportName: "publishDelivery",
			packageId: null,
			span: null,
			memberSpans: {},
		},
		value: actionValue,
	};
	const configuration = {
		application: { name: "collaboration" },
	} as ApplicationConfiguration;
	const common = {
		configuration,
		contextProjection: { context: null },
	};
	const baseline = projectRuntimeContract({
		...common,
		resources: [],
		sourceGraph: [],
	});
	const projected = projectRuntimeContract({
		...common,
		resources: [action],
		sourceGraph: [
			{
				path: "src/delivery-action.ts",
				contentDigest: "a".repeat(64),
				packageId: null,
			},
		],
	});
	const stagedNetworkIntent = projectRuntimeContract({
		...common,
		resources: [
			{
				...action,
				contract: normalizeActionContract(
					{ ...actionValue, network: true },
					codec,
				),
			},
		],
		sourceGraph: [
			{
				path: "src/delivery-action.ts",
				contentDigest: "a".repeat(64),
				packageId: null,
			},
		],
	});
	expect(projected.clientContract).toEqual(baseline.clientContract);
	expect(projected.wire).toEqual(baseline.wire);
	expect(stagedNetworkIntent.clientContract).toEqual(baseline.clientContract);
	expect(stagedNetworkIntent.wire).toEqual(baseline.wire);
	expect(stagedNetworkIntent.operationContracts.operations).toHaveLength(1);
	expect(projected.operationContracts.operations).toEqual([
		{
			identity: action.identity,
			input: contract.input,
			output: contract.output,
			declaredErrors: contract.declaredErrors,
			admission: "authenticated",
			limits: contract.limits,
		},
	]);
	expect(projected.executables.slots).toHaveLength(1);
	expect(projected.executables.slots[0]).toMatchObject({
		identity: action.identity,
		kind: "action",
		slot: "handler",
	});
});
