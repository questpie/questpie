import { expect, test } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "../../packages/compiler/src";
import { decodeRuntimeArtifacts } from "../../packages/runtime/src/application/artifacts";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

async function compileFixture(includeAction: boolean) {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-action-compiler-"));
	let compilation: Awaited<ReturnType<typeof compileApplication>> | undefined;
	let failed = false;
	let primary: unknown;
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		if (!includeAction)
			await rm(join(temporary, "src/delivery-action.ts"), { force: true });
		compilation = await compileApplication({ applicationRoot: temporary });
	} catch (error) {
		failed = true;
		primary = error;
	}
	try {
		await rm(temporary, { force: true, recursive: true });
	} catch (error) {
		if (!failed) {
			failed = true;
			primary = error;
		}
	}
	if (failed) throw primary;
	if (!compilation)
		throw new TypeError("Action fixture compilation is unavailable");
	return compilation;
}

test("projects one authored Action into exact direct and canonical HTTP artifacts", async () => {
	const baseline = await compileFixture(false);
	const compilation = await compileFixture(true);
	const contracts = JSON.parse(
		compilation.generatedFiles["operation-contracts.json"]!,
	) as Readonly<{ operations: readonly Readonly<Record<string, unknown>>[] }>;
	const executables = JSON.parse(
		compilation.generatedFiles["runtime-executables.json"]!,
	) as Readonly<{
		slots: readonly Readonly<{ identity: string; slot: string }>[];
	}>;
	const action = contracts.operations.find(
		(operation) => operation.identity === "action:delivery.publish",
	);

	expect(action).toEqual({
		identity: "action:delivery.publish",
		input: {
			kind: "object",
			properties: {
				effectKey: { kind: "text" },
				message: { kind: "text" },
			},
		},
		output: {
			kind: "object",
			properties: {
				attempt: { kind: "integer" },
				disposals: { kind: "integer" },
				receipt: { kind: "text" },
			},
		},
		admission: "authenticated",
		declaredErrors: {
			outcomeUnknown: {
				code: "OUTCOME_UNKNOWN",
				status: 503,
				payload: {
					kind: "object",
					properties: { reason: { kind: "text" } },
				},
			},
			providerRejected: {
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
	expect(
		executables.slots.map(({ identity, slot }) => `${identity}#${slot}`),
	).toContain("action:delivery.publish#handler");

	const app = compilation.generatedFiles["app.ts"]!;
	const runtime = compilation.generatedFiles["internal/application.js"]!;
	expect(app).toContain("export type GeneratedActionOperations");
	const actionOperations = app.slice(
		app.indexOf("export type GeneratedActionOperations"),
		app.indexOf("export type ActionLimits"),
	);
	expect(actionOperations).toContain('readonly "delivery"');
	expect(actionOperations).toContain('readonly "publish"');
	expect(actionOperations).not.toContain('readonly "delivery.publish"');
	expect(app).toContain("readonly effectKey: string");
	expect(app).toContain("readonly callId?: string");
	expect(app).toContain("readonly timeoutMilliseconds?: number");
	expect(app).toContain("actions: GeneratedActionOperations");
	expect(runtime).toContain("createRuntimeActionExecutor");

	const baselineHttp = JSON.parse(
		baseline.generatedFiles["operation-http-contract.json"]!,
	) as Readonly<{ digest: string; version: number }>;
	const http = JSON.parse(
		compilation.generatedFiles["operation-http-contract.json"]!,
	) as Readonly<{
		digest: string;
		format: string;
		operations: readonly Readonly<{ identity: string }>[];
		version: number;
	}>;
	expect(baselineHttp.version).toBe(1);
	expect(http).toMatchObject({ format: "questpie.operation-http", version: 1 });
	expect(http).not.toHaveProperty("compatibility");
	expect(http.operations.map(({ identity }) => identity)).toEqual([
		"action:delivery.publish",
		"mutation:message.publish",
		"mutation:message.requestDigest",
		"query:channels.detail",
		"query:messages.page",
	]);
	expect(http.digest).not.toBe(baselineHttp.digest);
	const decoded = decodeRuntimeArtifacts({
		runtimeBuild: JSON.parse(compilation.generatedFiles["runtime-build.json"]!),
		runtimeExecutables: executables,
		operationContracts: contracts,
		httpContract: http,
	});
	expect(decoded.httpContract.version).toBe(1);
	expect(decoded.runtimeBuild.operationHttpContractDigest).toBe(http.digest);

	const client = compilation.generatedFiles["client.ts"]!;
	expect(client).not.toBe(baseline.generatedFiles["client.ts"]);
	expect(client).toContain("readonly actions:");
	expect(client).toContain("readonly effectKey: string");
	expect(client).toContain('"delivery.publish":');
	expect(client).toContain('"action:delivery.publish"');
	expect(client).toContain("ACTION_OUTCOME_AMBIGUOUS");
	expect(client).not.toContain("retry?:");
}, 30_000);
