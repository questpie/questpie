import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { access, cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deriveDurableEffectIdentity, deriveEffectIdentity } from "./contract";
import retainedWireV2 from "./retained-wire-v2.json";

const canonicalRoot =
	process.env.QUESTPIE_CANONICAL_ROOT ??
	new TextDecoder()
		.decode(Bun.spawnSync(["git", "rev-parse", "--show-toplevel"]).stdout)
		.trim();
const dependencyRoot = process.env.QUESTPIE_DEPENDENCY_ROOT ?? canonicalRoot;
const prerequisite = Bun.spawnSync([
	"git",
	"-C",
	canonicalRoot,
	"merge-base",
	"--is-ancestor",
	"c68309f3",
	"HEAD",
]);
assert.equal(
	prerequisite.exitCode,
	0,
	"canonical repository does not contain prerequisite c68309f3",
);
for (const path of [
	"packages/compiler",
	"packages/runtime",
	"fixtures/collaboration",
]) {
	const proofTree = new TextDecoder()
		.decode(
			Bun.spawnSync(["git", "-C", canonicalRoot, "rev-parse", `HEAD:${path}`])
				.stdout,
		)
		.trim();
	const dependencyTree = new TextDecoder()
		.decode(
			Bun.spawnSync(["git", "-C", dependencyRoot, "rev-parse", `HEAD:${path}`])
				.stdout,
		)
		.trim();
	assert.equal(
		dependencyTree,
		proofTree,
		`${path} dependency bytes differ from the proof head`,
	);
}
const compilerUrl = new URL(
	`file://${dependencyRoot}/packages/compiler/src/index.ts`,
).href;
const fixtureRoot = new URL(`file://${dependencyRoot}/fixtures/collaboration/`);
const { compileApplication } = (await import(compilerUrl)) as Readonly<{
	compileApplication(
		input: Readonly<{ applicationRoot: string }>,
	): Promise<Readonly<{ generatedFiles: Readonly<Record<string, string>> }>>;
}>;
const durableRowsUrl = new URL(
	`file://${dependencyRoot}/packages/runtime/src/durable/rows.ts`,
).href;
const { effectIdentity: productionDurableEffectIdentity } = (await import(
	durableRowsUrl
)) as Readonly<{
	effectIdentity(
		application: string,
		runId: string,
		effectName: string,
	): string;
}>;

for (const vector of [
	{
		application: "application:collaboration",
		runId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
		effectName: "deliver",
		expected: "64a789a4-c319-5d2b-ac27-520d9808a941",
	},
	{
		application: "application:collaboration",
		runId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a1",
		effectName: "notify",
		expected: "89bfe8da-1743-52dc-a499-8689a3b4d4bc",
	},
	{
		application: "application:billing",
		runId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2",
		effectName: "charge",
		expected: "e044abb1-8329-555d-ac20-2c90a76acabc",
	},
] as const) {
	const production = productionDurableEffectIdentity(
		vector.application,
		vector.runId,
		vector.effectName,
	);
	assert.equal(production, vector.expected);
	assert.equal(
		deriveDurableEffectIdentity(
			vector.application,
			vector.runId,
			vector.effectName,
		),
		production,
		"proof durable Effect Identity model drifted from production",
	);
	assert.notEqual(
		deriveEffectIdentity({
			application: vector.application,
			tenant: vector.runId,
			principal: { kind: "service", id: "durable-proof" },
			action: "action:delivery.publish",
			effectKey: vector.effectName,
		}),
		production,
		"ordinary Action and production durable Effect Identity domains collided",
	);
}

const temporary = await mkdtemp(
	join(tmpdir(), "questpie-action-wire-v3-repo-"),
);
try {
	await cp(fixtureRoot, temporary, { recursive: true });
	try {
		await access(join(temporary, "node_modules"));
	} catch {
		await symlink(
			join(dependencyRoot, "fixtures/collaboration/node_modules"),
			join(temporary, "node_modules"),
			"dir",
		);
	}
	const compilation = await compileApplication({ applicationRoot: temporary });
	const generatedBytes = compilation.generatedFiles["wire-contract.json"];
	assert.equal(typeof generatedBytes, "string");
	assert.equal(
		generatedBytes,
		`${JSON.stringify(retainedWireV2)}\n`,
		"retained Wire v2 bytes drifted from the current collaboration compiler",
	);
	assert.deepEqual(JSON.parse(generatedBytes!), retainedWireV2);
	assert.equal(
		createHash("sha256").update(generatedBytes!).digest("hex"),
		"9406660f578d8760666783edff4e4189255dba8ee07ac4ac9fc3e0fdca2a5090",
		"retained Wire v2 content digest changed",
	);
	assert.equal(
		retainedWireV2.digest,
		"4d8dfdda7d345318ff6dc9954a771ceff227eb6ffc534a581df84cf31e807270",
	);
	assert.equal(
		retainedWireV2.compatibility.wireV1Digest,
		"5e95eb656702b28ae229f7a36de94e0ee1e44c1b4100fc93f8f222f0ca36727c",
	);
} finally {
	await rm(temporary, { force: true, recursive: true });
}

console.log("Action Wire v3 repository artifact binding PASS");
