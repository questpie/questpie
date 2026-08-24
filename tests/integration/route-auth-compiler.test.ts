import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

import {
	compositionContract,
	projectExecutionComposition,
} from "../../packages/compiler/src/composition";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

test("compiles one application credential resolver and authored Route into the generated application", async () => {
	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	const executables = JSON.parse(
		compilation.generatedFiles["runtime-executables.json"]!,
	) as Readonly<{
		slots: readonly Readonly<{ identity: string; slot: string }>[];
	}>;

	expect(
		executables.slots.map(({ identity, slot }) => `${identity}#${slot}`),
	).toEqual(
		expect.arrayContaining([
			"credentialResolver:collaboration.credentials#resolve",
			"route:collaboration.whoami#handler",
		]),
	);
	expect(compilation.generatedFiles["app.ts"]).toContain(
		'readonly "collaboration.whoami":',
	);
	expect(compilation.generatedFiles["internal/application.js"]).toContain(
		"createRuntimeRouteExecutor",
	);
});

function routeResource(name: string, path: string) {
	return {
		kind: "route",
		identity: `route:${name}`,
		name,
		origin: { path: `${name}.ts`, exportName: name, packageId: null },
		contract: compositionContract("route", {
			name,
			method: "GET",
			path,
			credentials: "none",
			policy: { kind: "booleanExpression", operator: "public", operands: [] },
			limits: { bodyBytes: 0, durationMs: 1_000 },
		}),
	} as never;
}

test("rejects ambiguous parameter and wildcard Route overlaps", () => {
	expect(() =>
		projectExecutionComposition([
			routeResource("first", "/accounts/:accountId"),
			routeResource("second", "/accounts/:id"),
		]),
	).toThrow("ambiguous Route mounts");
	expect(() =>
		projectExecutionComposition([
			routeResource("first", "/assets/*path"),
			routeResource("second", "/assets/*rest"),
		]),
	).toThrow("ambiguous Route mounts");
});

test("rejects invalid Route parameter and wildcard grammar", () => {
	for (const path of ["/accounts/:", "/assets/*path/tail", "/assets/**"])
		expect(() => routeResource("invalid", path)).toThrow(
			"Route path grammar is invalid",
		);
});
