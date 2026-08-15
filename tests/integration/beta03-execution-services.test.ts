import { beforeEach, expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

import {
	codec,
	defineContext,
	defineService,
	principal,
} from "../../packages/questpie/src";
import { createApplicationRuntime } from "../../packages/runtime/src";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const principalId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4";

let lifecycle: string[];
let applicationCreates: number;
let executionCreates: number;

beforeEach(() => {
	lifecycle = [];
	applicationCreates = 0;
	executionCreates = 0;
});

test("coalesces execution Service creation and cancels in reverse cleanup order", async () => {
	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	expect(compilation.generatedFiles["service-projection.json"]).toBeDefined();
	expect(compilation.generatedFiles["context-projection.json"]).toBeDefined();

	const auditConnection = defineService({
		name: "audit.connection",
		lifetime: "application",
		effect: "read",
		create: () => {
			applicationCreates += 1;
			lifecycle.push(`create:application:${applicationCreates}`);
			return Object.freeze({ id: applicationCreates });
		},
		dispose: (instance) => {
			lifecycle.push(`dispose:application:${instance.id}`);
		},
	});
	const executionAudit = defineService({
		name: "audit.execution",
		lifetime: "execution",
		effect: "read",
		dependencies: { connection: auditConnection },
		create: ({ services }) => {
			executionCreates += 1;
			lifecycle.push(`create:execution:${executionCreates}`);
			return Object.freeze({
				connectionId: services.connection.id,
				id: executionCreates,
			});
		},
		dispose: (instance) => {
			lifecycle.push(`dispose:execution:${instance.id}`);
		},
	});
	const collaborationContext = defineContext({
		name: "app.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input, principal: executionPrincipal }) => ({
			tenant: { id: input.companyId },
			values: { principalId: executionPrincipal.id },
		}),
	});
	const runtime = createApplicationRuntime({
		services: [auditConnection, executionAudit],
		context: collaborationContext,
		bootstrap: { get: async () => null },
		project: async ({ facts, service }) => {
			const [first, second] = await Promise.all([
				service(executionAudit),
				service(executionAudit),
			]);
			return Object.freeze({ facts, first, second });
		},
	});
	const controller = new AbortController();
	let callbackStarted!: () => void;
	const started = new Promise<void>((resolveStarted) => {
		callbackStarted = resolveStarted;
	});

	const execution = runtime.execution(
		{
			principal: principal.user({ id: principalId }),
			context: { companyId },
			signal: controller.signal,
		},
		async ({ facts, first, second }) => {
			expect(first).toBe(second);
			expect(first.connectionId).toBe(1);
			expect(Object.isFrozen(facts)).toBe(true);
			expect(facts.values.principalId).toBe(principalId);
			callbackStarted();
			await new Promise<never>((_resolve, reject) => {
				facts.signal.addEventListener(
					"abort",
					() => reject(facts.signal.reason),
					{ once: true },
				);
			});
		},
	);

	await started;
	controller.abort(new Error("cancel execution"));
	await expect(execution).rejects.toThrow("cancel execution");
	expect({ applicationCreates, executionCreates, lifecycle }).toEqual({
		applicationCreates: 1,
		executionCreates: 1,
		lifecycle: [
			"create:application:1",
			"create:execution:1",
			"dispose:execution:1",
		],
	});

	await runtime.close();
	expect(lifecycle).toEqual([
		"create:application:1",
		"create:execution:1",
		"dispose:execution:1",
		"dispose:application:1",
	]);
});
