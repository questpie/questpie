import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runTypeScriptProof } from "./typescript-proof.mjs";

const proofRoot = path.dirname(fileURLToPath(import.meta.url));
const proofStartedAt = performance.now();

const canonical = (value) => {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, canonical(value[key])]),
		);
	return value;
};

const bytes = (value) => JSON.stringify(canonical(value));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const compareAscii = (left, right) =>
	left < right ? -1 : left > right ? 1 : 0;
const callableInvocations = [];

class ProjectionCollision extends Error {
	constructor(kind, left, right) {
		const candidates = [left, right].sort((a, b) =>
			compareAscii(bytes(a), bytes(b)),
		);
		super(
			`QP-COMPOSE-023 operationProjectionCollision: ${kind}:${candidates[0].name} collides with ${kind}:${candidates[1].name}`,
		);
		this.code = "QP-COMPOSE-023";
		this.diagnosticClass = "operationProjectionCollision";
		this.details = { kind, candidates };
	}
}

class ProjectionUnsafeName extends Error {
	constructor(kind, definition) {
		super(
			`QP-COMPOSE-024 operationProjectionUnsafeName: ${kind}:${definition.name} would make a public capability namespace thenable`,
		);
		this.code = "QP-COMPOSE-024";
		this.diagnosticClass = "operationProjectionUnsafeName";
		this.details = { kind, definition, segment: "then" };
	}
}

class InvalidResourceName extends Error {
	constructor(kind, definition) {
		super(`QP-COMPOSE-003 invalidResourceName: ${kind}:${definition.name}`);
		this.code = "QP-COMPOSE-003";
		this.diagnosticClass = "invalidResourceName";
		this.details = { kind, definition };
	}
}

const node = () => ({ children: new Map(), terminal: undefined });

function buildOperationProjection(kind, definitions) {
	const root = node();
	for (const definition of [...definitions].sort((left, right) =>
		compareAscii(left.name, right.name),
	)) {
		const segments = definition.name.split(".");
		if (
			definition.name.length > 255 ||
			segments.some(
				(segment) =>
					segment.length > 63 || !/^[a-z][A-Za-z0-9]*$/.test(segment),
			)
		)
			throw new InvalidResourceName(kind, definition);
		if (segments.at(-1) === "then")
			throw new ProjectionUnsafeName(kind, definition);
		let current = root;
		for (const segment of segments) {
			if (current.terminal)
				throw new ProjectionCollision(kind, current.terminal, definition);
			let child = current.children.get(segment);
			if (!child) {
				child = node();
				current.children.set(segment, child);
			}
			current = child;
		}
		current.terminal = definition;
	}

	const materialize = (current) => {
		const result = Object.create(null);
		for (const [segment, child] of [...current.children].sort(
			([left], [right]) => compareAscii(left, right),
		)) {
			const value = child.terminal
				? Object.freeze(
						Object.assign(
							async () => {
								const identity = `${kind}:${child.terminal.name}`;
								callableInvocations.push(identity);
								return Object.freeze({ identity });
							},
							{ identity: `${kind}:${child.terminal.name}` },
						),
					)
				: materialize(child);
			Object.defineProperty(result, segment, {
				value,
				enumerable: true,
				writable: false,
				configurable: false,
			});
		}
		return Object.freeze(result);
	};

	return materialize(root);
}

const projection = JSON.parse(
	await readFile(path.join(proofRoot, "PROJECTION.json"), "utf8"),
);
const hostileProjection = JSON.parse(
	await readFile(path.join(proofRoot, "HOSTILE-PROJECTION.json"), "utf8"),
);
const actionDefinitions = projection.action;
const mutationDefinitions = projection.mutation;

const actions = buildOperationProjection("action", actionDefinitions);
const mutations = buildOperationProjection("mutation", mutationDefinitions);
assert.equal(Object.getPrototypeOf(actions), null);
assert.equal(Object.getPrototypeOf(actions.constructor), null);
assert.equal(Object.getPrototypeOf(actions.prototype), null);
assert.equal(Object.getPrototypeOf(actions.then), null);
assert.equal(
	actions.delivery.sendMessage.identity,
	"action:delivery.sendMessage",
);
assert.equal(
	mutations.messages.recordDelivery.identity,
	"mutation:messages.recordDelivery",
);
assert.equal(actions["delivery.sendMessage"], undefined);
assert.equal(typeof actions.delivery.sendMessage, "function");
const callsBeforeAssimilation = callableInvocations.length;
assert.equal(await Promise.resolve(actions), actions);
assert.equal(await Promise.resolve(actions.delivery), actions.delivery);
assert.equal(
	await Promise.resolve(actions.delivery.sendMessage),
	actions.delivery.sendMessage,
);
assert.equal(callableInvocations.length, callsBeforeAssimilation);

let collision;
try {
	buildOperationProjection("action", hostileProjection.prefixCollision);
} catch (error) {
	collision = error;
}
assert.equal(collision?.code, "QP-COMPOSE-023");
assert.deepEqual(
	collision?.details.candidates.map((item) => item.origin),
	["app/actions/delivery.ts:2", "packages/mail/actions.ts:8"],
);

let reverseCollision;
try {
	buildOperationProjection(
		"action",
		hostileProjection.prefixCollision.toReversed(),
	);
} catch (error) {
	reverseCollision = error;
}
assert.equal(reverseCollision?.message, collision?.message);
assert.deepEqual(reverseCollision?.details, collision?.details);

const unsafeThenDiagnostics = [];
for (const definition of hostileProjection.unsafeThenLeaves) {
	try {
		buildOperationProjection("action", [definition]);
	} catch (error) {
		unsafeThenDiagnostics.push(error);
	}
}
assert.equal(unsafeThenDiagnostics.length, 2);
assert.ok(
	unsafeThenDiagnostics.every((item) => item.code === "QP-COMPOSE-024"),
);

const invalidNames = hostileProjection.invalidNames.map((item) => item.name);
for (const definition of hostileProjection.invalidNames) {
	let invalid;
	try {
		buildOperationProjection("action", [definition]);
	} catch (error) {
		invalid = error;
	}
	assert.equal(invalid?.code, "QP-COMPOSE-003");
}
for (const fixture of hostileProjection.invalidLengths) {
	const name =
		fixture.kind === "segment"
			? "a".repeat(fixture.length)
			: Array.from({ length: fixture.segments }, () =>
					"a".repeat(fixture.segmentLength),
				).join(".");
	let invalid;
	try {
		buildOperationProjection("action", [{ name, origin: fixture.origin }]);
	} catch (error) {
		invalid = error;
	}
	assert.equal(invalid?.code, "QP-COMPOSE-003");
}

assert.doesNotThrow(() => {
	buildOperationProjection("action", [
		hostileProjection.crossKindSameName.action,
	]);
	buildOperationProjection("mutation", [
		hostileProjection.crossKindSameName.mutation,
	]);
});

const externalIdentities = new Map([
	["action:delivery.send", { kind: "action", name: "delivery.send" }],
	["mutation:delivery.send", { kind: "mutation", name: "delivery.send" }],
]);
assert.equal(externalIdentities.size, 2);
assert.equal(externalIdentities.get("action:delivery.send")?.kind, "action");
assert.equal(
	externalIdentities.get("mutation:delivery.send")?.kind,
	"mutation",
);

const capabilityMap = await readFile(
	path.join(proofRoot, "CAPABILITY-MAP.md"),
	"utf8",
);
for (const owner of [
	"normalize",
	"values",
	"Query",
	"Mutation",
	"Action",
	"Policy",
	"Route",
	"Reaction",
	"Job",
	"Workflow",
	"Live Query",
	"Channel",
])
	assert.match(capabilityMap, new RegExp(`\\b${owner}\\b`));
assert.doesNotMatch(
	capabilityMap,
	/beforeValidate|beforeChange|afterChange|afterRead/,
);

const typeScript = await runTypeScriptProof();
const evidence = JSON.parse(
	await readFile(path.join(proofRoot, "EVIDENCE.json"), "utf8"),
);
const measurements = JSON.parse(
	await readFile(path.join(proofRoot, "MEASUREMENTS.json"), "utf8"),
);
assert.equal(typeScript.typeScript, measurements.environment.typescript);
assert.equal(Bun.version, measurements.environment.bun);
assert.deepEqual(
	evidence.editor.actionRootCompletions,
	typeScript.completions["/*ACTION_ROOT*/"],
);
assert.deepEqual(
	evidence.editor.deliveryCompletions,
	typeScript.completions["/*ACTION_MEMBER*/"],
);
assert.deepEqual(
	evidence.editor.mutationRootCompletions,
	typeScript.completions["/*MUTATION_ROOT*/"],
);
assert.deepEqual(
	evidence.editor.messagesCompletions,
	typeScript.completions["/*MUTATION_MEMBER*/"],
);
const normalizeTypeText = (value) => value.replaceAll(/\s+/g, " ").trim();
assert.equal(
	normalizeTypeText(evidence.editor.sendMessageHover),
	normalizeTypeText(typeScript.hover),
);
assert.equal(
	evidence.diagnostics[0].origins.join("\n"),
	collision.details.candidates.map((item) => item.origin).join("\n"),
);
assert.equal(evidence.diagnostics[0].code, collision.code);
assert.ok(
	unsafeThenDiagnostics.every(
		(item) => item.code === evidence.diagnostics[1].code,
	),
);
assert.deepEqual(
	evidence.diagnostics[1].identities,
	hostileProjection.unsafeThenLeaves.map((item) => `action:${item.name}`),
);
assert.equal(evidence.diagnostics[2].code, "QP-COMPOSE-003");
assert.deepEqual(evidence.diagnostics[2].fixtures, invalidNames);
assert.equal(
	evidence.factorySelection.mixedDefineNamespaceDiagnostic,
	`TS${typeScript.namespacedMixedImportDiagnostic}`,
);
assert.ok(
	Object.values(evidence.hostileCases).every((status) => status === "PASS"),
);
assert.equal(measurements.digests.capabilityMapSha256, sha256(capabilityMap));
assert.equal(measurements.digests.projectionSha256, sha256(bytes(projection)));
assert.equal(
	measurements.digests.generatedDeclarationsSha256,
	typeScript.declarationDigest,
);
assert.equal(
	measurements.declarations.maximumMeasuredBytes,
	typeScript.maximumMeasuredDeclarationBytes,
);
for (const size of ["small", "large"]) {
	assert.equal(
		measurements.digests[
			`operations${typeScript.stress[size].operations}Sha256`
		],
		typeScript.stress[size].declarationDigest,
	);
	assert.equal(
		measurements.editor[`operations${typeScript.stress[size].operations}`]
			.depth,
		typeScript.stress[size].depth,
	);
	assert.ok(
		measurements.editor[`operations${typeScript.stress[size].operations}`]
			.completionP95Milliseconds <= measurements.editor.budgetP95Milliseconds,
	);
	assert.ok(
		measurements.editor[`operations${typeScript.stress[size].operations}`]
			.hoverP95Milliseconds <= measurements.editor.budgetP95Milliseconds,
	);
}
assert.ok(
	measurements.focusedRunner.wallMilliseconds <=
		measurements.focusedRunner.budgetMilliseconds,
);
assert.ok(
	measurements.typescript.instantiations <= measurements.typescript.budget,
);
const repositoryRoot = path.resolve(proofRoot, "../../../..");
const compilerMeasurement = Bun.spawnSync(
	[
		"bun",
		"node_modules/typescript/bin/tsc",
		"-p",
		"docs/v4/prototypes/api-ergonomics-gate/types/tsconfig.json",
		"--pretty",
		"false",
		"--extendedDiagnostics",
	],
	{ cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" },
);
assert.equal(
	compilerMeasurement.exitCode,
	0,
	compilerMeasurement.stderr.toString(),
);
const measuredInstantiations = Number.parseInt(
	compilerMeasurement.stdout
		.toString()
		.match(/^Instantiations:\s+(\d+)$/m)?.[1] ?? "",
	10,
);
assert.equal(measuredInstantiations, measurements.typescript.instantiations);
assert.ok(
	typeScript.maximumMeasuredDeclarationBytes <=
		measurements.declarations.budgetBytes,
);
assert.ok(performance.now() - proofStartedAt <= 5_000);
const result = {
	format: "questpie.api-ergonomics-proof",
	version: 1,
	selectedFactoryFamily: "defineKind",
	canonicalOperationIdentity: "exact-qualified-name",
	publicOperationProjection: "nested-only",
	prefixCollisionDiagnostic: "QP-COMPOSE-023",
	thenableNamespaceDiagnostic: "QP-COMPOSE-024",
	prototypeSafeNullObjects: true,
	crossKindSameNameAllowed: true,
	externalIdentityProjection: "kind-qualified",
	durableKernel: "one-run-attempt-lease-history-kernel",
	durableAuthoring: ["Job", "Reaction", "Workflow"],
	capabilityMapDigest: sha256(capabilityMap),
	projectionDigest: sha256(bytes(projection)),
	typeScript,
	measuredInstantiations,
};

console.log(JSON.stringify(result, null, 2));
