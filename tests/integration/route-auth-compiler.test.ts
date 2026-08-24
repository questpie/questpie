import { expect, test } from "bun:test";
import { resolve } from "node:path";

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
