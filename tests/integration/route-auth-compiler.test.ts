import { expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

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

async function compileRouteSource(source: string) {
	const temporary = await mkdtemp(
		join(resolve(fixtureRoot, ".."), ".route-auth-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		await writeFile(join(temporary, "src/route-proof.ts"), source);
		return await compileApplication({ applicationRoot: temporary });
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

function routeSource(firstPath: string, secondPath?: string): string {
	const route = (name: string, path: string) => `
export const ${name} = defineRoute({
  name: ${JSON.stringify(`proof.${name}`)}, method: "GET", path: ${JSON.stringify(path)},
  policy: policy.public(), credentials: "none",
  limits: { bodyBytes: 0, durationMs: 1000 },
  handler: (_input: unknown) => new Response(null, { status: 204 }),
} as never);`;
	return `import { policy } from "questpie";
import { defineRoute } from "#questpie/app";
${route("first", firstPath)}
${secondPath ? route("second", secondPath) : ""}`;
}

test("rejects source-derived ambiguous parameter Route overlaps", async () => {
	await expect(
		compileRouteSource(routeSource("/accounts/:accountId", "/accounts/:id")),
	).rejects.toThrow("ambiguous Route mounts");
});

test("rejects source-derived ambiguous wildcard Route overlaps", async () => {
	await expect(
		compileRouteSource(routeSource("/assets/*path", "/assets/*rest")),
	).rejects.toThrow("ambiguous Route mounts");
});

test("rejects source-derived invalid Route parameter grammar", async () => {
	await expect(compileRouteSource(routeSource("/accounts/:"))).rejects.toThrow(
		"Route path grammar is invalid",
	);
});

test("compiles exact and wildcard precedence into the generated mount", async () => {
	const compilation = await compileRouteSource(
		routeSource("/assets", "/assets/*rest"),
	);
	expect(compilation.generatedFiles["internal/application.js"]).toContain(
		'path:"/assets/*rest"',
	);
	expect(compilation.generatedFiles["app.ts"]).toContain("RouteParams<Path>");
	expect(compilation.generatedFiles["app.ts"]).toContain("deadline: number");
});
