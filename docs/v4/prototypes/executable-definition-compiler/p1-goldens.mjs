import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// Executable byte-level witness for P1. It deliberately models compiler
// contracts only. No handler is executed and no Runtime behavior is claimed.

export const FOUNDATIONAL_DIGESTS = Object.freeze({
	schema: "9d757239d4033d042b741b410df593420e14216ae1147173e0f75b2afd5a7033",
	data: "0d5af01332f05f1c4a02cf543c0d242f450adfd378ac455f218df876038c9b4f",
	structuralQuery:
		"a8512fb577f3c4dd653d714f5191f1311788237e9f5d81813bd24c7452f57ac1",
});

const FACTORY_ALLOWLIST = Object.freeze([
	"defineAction",
	"defineJob",
	"defineMutation",
	"defineQuery",
	"defineReaction",
	"defineRoute",
]);

const RESOURCE_KIND_BY_FACTORY = Object.freeze({
	defineAction: "action",
	defineJob: "job",
	defineMutation: "mutation",
	defineQuery: "query",
	defineReaction: "reaction",
	defineRoute: "route",
});

function compareAscii(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalValue(value) {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value)
				.sort(compareAscii)
				.map((key) => [key, canonicalValue(value[key])]),
		);
	}
	return value;
}

function bytes(value) {
	return JSON.stringify(canonicalValue(value)) + "\n";
}

function digest(prefix, value) {
	return createHash("sha256").update(prefix).update(bytes(value)).digest("hex");
}

function diagnostic(
	code,
	diagnosticClass,
	identity,
	origins,
	summary,
	recovery,
) {
	return {
		format: "questpie.diagnostic",
		version: 1,
		code,
		class: diagnosticClass,
		severity: "error",
		blocking: code === "QP-COMPOSE-018" ? "deploy" : "fatal",
		identity,
		origins: [...origins].sort((left, right) =>
			compareAscii(bytes(left), bytes(right)),
		),
		summary,
		expected: null,
		actual: null,
		recovery,
	};
}

function appOrigin(path, exportName, line) {
	return {
		kind: "export",
		packageId: null,
		path,
		exportName,
		span: {
			start: { line, column: 1 },
			end: { line: line + 18, column: 2 },
		},
		declaredAt: null,
	};
}

function packageOrigin(path, exportName, line) {
	return {
		kind: "export",
		packageId: "package-acme-audit-v1",
		path,
		exportName,
		span: {
			start: { line, column: 1 },
			end: { line: line + 12, column: 2 },
		},
		declaredAt: null,
	};
}

function scalar(kind) {
	return { kind };
}

function object(properties) {
	return { kind: "object", properties };
}

function nullable(value) {
	return { kind: "nullable", value };
}

function array(items) {
	return { kind: "array", items };
}

function ref(identity) {
	return { kind: "operationOutput", identity };
}

const connectedDefinitions = [
	{
		factory: "defineQuery",
		name: "companies.summary",
		input: object({ companyId: scalar("uuid") }),
		outputExpression: nullable(object({ name: scalar("text") })),
		handler: "inline:companies.summary:v1",
		lexicalDependencies: ["helper:format-company:v1"],
		origin: appOrigin("src/features/companies/summary.ts", "companySummary", 7),
	},
	{
		factory: "defineQuery",
		name: "companies.importedCheck",
		input: object({ companyId: scalar("uuid") }),
		outputExpression: object({ found: scalar("boolean") }),
		handler: "imported:company-check:v1",
		lexicalDependencies: ["src/features/companies/imported-query-handler.ts"],
		origin: appOrigin(
			"src/features/companies/imported-check.ts",
			"importedCompanyCheck",
			5,
		),
		handlerOrigin: appOrigin(
			"src/features/companies/imported-query-handler.ts",
			"importedHandler",
			8,
		),
	},
	{
		factory: "defineQuery",
		name: "messages.summary",
		input: object({ id: scalar("uuid") }),
		outputExpression: nullable(
			object({ id: scalar("uuid"), body: scalar("text") }),
		),
		handler: "inline:messages.summary:v1",
		lexicalDependencies: [],
		origin: appOrigin("src/features/messages/summary.ts", "messageSummary", 4),
	},
	{
		factory: "defineQuery",
		name: "reports.companyDigest",
		input: object({ companyId: scalar("uuid") }),
		outputExpression: ref("query:companies.summary"),
		handler: "inline:reports.companyDigest:v1",
		lexicalDependencies: [],
		origin: appOrigin(
			"src/features/reports/company-digest.ts",
			"companyDigest",
			4,
		),
	},
	{
		factory: "defineMutation",
		name: "messages.rename",
		input: object({ id: scalar("uuid"), body: scalar("text") }),
		outputExpression: nullable(
			object({
				id: scalar("uuid"),
				body: scalar("text"),
				updatedAt: scalar("timestamp"),
			}),
		),
		handler: "inline:messages.rename:v1",
		lexicalDependencies: [],
		origin: appOrigin("src/features/messages/rename.ts", "renameMessage", 6),
	},
	{
		factory: "defineAction",
		name: "delivery.send",
		input: object({ body: scalar("text"), effectKey: scalar("text") }),
		outputExpression: object({ providerId: scalar("text") }),
		handler: "inline:delivery.send:v1",
		lexicalDependencies: ["provider:sdk:v1"],
		origin: appOrigin("src/features/delivery/send.ts", "sendDelivery", 5),
	},
	{
		factory: "defineReaction",
		name: "messageRenamed",
		input: object({ messageId: scalar("uuid") }),
		outputExpression: object({ kind: scalar("text") }),
		handler: "inline:messageRenamed:v1",
		lexicalDependencies: [],
		origin: appOrigin("src/features/messages/reaction.ts", "messageRenamed", 5),
	},
	{
		factory: "defineJob",
		name: "companyDigest",
		input: object({ companyId: scalar("uuid") }),
		outputExpression: object({ title: scalar("text") }),
		handler: "inline:companyDigest:v1",
		lexicalDependencies: [],
		origin: appOrigin("src/features/reports/job.ts", "companyDigest", 5),
	},
	{
		factory: "defineRoute",
		name: "delivery.webhook",
		input: object({ request: scalar("request") }),
		outputExpression: object({ response: scalar("response") }),
		handler: "inline:delivery.webhook:v1",
		lexicalDependencies: ["provider:verification:v1"],
		origin: appOrigin("src/features/delivery/webhook.ts", "deliveryWebhook", 5),
	},
];

const operationSet = {
	collection: "collection:messages",
	prefix: "messages",
	members: ["list", "get", "create", "update", "delete"],
	origin: appOrigin(
		"src/features/messages/operations.ts",
		"messageOperations",
		4,
	),
};

const memberKind = Object.freeze({
	list: "query",
	get: "query",
	create: "mutation",
	update: "mutation",
	delete: "mutation",
});

function expandOperationSet(set) {
	return [...set.members]
		.sort(compareAscii)
		.map((member) => {
			const identity = `${memberKind[member]}:${set.prefix}.${member}`;
			const structuralContract = {
				mode: memberKind[member] === "query" ? "readSnapshot" : "transaction",
				collection: set.collection,
				member,
			};
			return {
				identity,
				owner: identity,
				origin: { ...set.origin, member },
				structuralContract,
				structuralContractDigest: digest(
					"questpie-structural-contract-v1\0",
					structuralContract,
				),
				generatedAlias: `collections.messages.${member}`,
				canonicalMember: `${memberKind[member]}s[\"messages.${member}\"]`,
			};
		})
		.sort((left, right) => compareAscii(left.identity, right.identity));
}

function substituteCurrentVirtualFactory(exportName) {
	if (!FACTORY_ALLOWLIST.includes(exportName)) {
		throw diagnostic(
			"QP-EXEC-001",
			"generatedValueNotAllowed",
			null,
			[],
			`The structural evaluator cannot import #questpie/app value ${exportName}.`,
			[],
		);
	}
	return Object.freeze({ kind: "currentVirtualFactory", exportName });
}

function sliceDefinition(definition, handlerOnlyInitializer) {
	const kind = RESOURCE_KIND_BY_FACTORY[definition.factory];
	assert.ok(kind);
	const identity = `${kind}:${definition.name}`;
	const structural = {
		identity,
		factory: definition.factory,
		input: definition.input,
		outputPin: definition.outputPin ?? null,
		handler: { kind: "executableSlot", identity: `${identity}/handler` },
	};
	const runtime = {
		identity,
		slot: "handler",
		handler: definition.handler,
		lexicalDependencies: [...definition.lexicalDependencies].sort(compareAscii),
	};
	assert.equal(handlerOnlyInitializer.count, 0);
	return {
		structural,
		runtime,
		structuralDigest: digest("questpie-p1-structural-v1\0", structural),
		runtimeGraphDigest: digest("questpie-p1-runtime-graph-v1\0", runtime),
	};
}

function proveHandlerSlicingParity() {
	const base = {
		factory: "defineQuery",
		name: "slicing.sameContract",
		input: object({ id: scalar("uuid") }),
		outputExpression: object({ id: scalar("uuid") }),
		lexicalDependencies: ["helper:shared:v1"],
		origin: appOrigin("src/slicing.ts", "slicingProof", 1),
	};
	const initializer = { count: 0 };
	const inline = sliceDefinition(
		{ ...base, handler: "inline:slicing.sameContract" },
		initializer,
	);
	const imported = sliceDefinition(
		{
			...base,
			handler: "imported:slicing.sameContract",
			handlerOrigin: appOrigin("src/slicing-handler.ts", "handler", 1),
		},
		initializer,
	);
	assert.equal(inline.structuralDigest, imported.structuralDigest);
	assert.notEqual(inline.runtimeGraphDigest, imported.runtimeGraphDigest);
	assert.equal(initializer.count, 0);
	const sharedImpureCapture = diagnostic(
		"QP-EXEC-007",
		"unsliceableSharedCapture",
		"query:slicing.sameContract",
		[base.origin, appOrigin("src/impure-helper.ts", "machineValue", 1)],
		"A handler capture also reaches the structural graph through an impure initializer.",
		[],
	);
	assert.equal(sharedImpureCapture.origins.length, 2);
	return { inline, imported, sharedImpureCapture };
}

function resolveOutputs(definitions) {
	const outputs = new Map();
	const pending = new Map();
	for (const definition of definitions) {
		const kind = RESOURCE_KIND_BY_FACTORY[definition.factory];
		const identity = `${kind}:${definition.name}`;
		if (definition.outputPin) outputs.set(identity, definition.outputPin);
		else pending.set(identity, definition);
	}

	const rounds = [];
	while (pending.size > 0) {
		const resolvedThisRound = [];
		for (const [identity, definition] of [...pending.entries()].sort(
			([left], [right]) => compareAscii(left, right),
		)) {
			const expression = definition.outputExpression;
			if (expression.kind === "operationOutput") {
				const target = outputs.get(expression.identity);
				if (!target) continue;
				outputs.set(identity, target);
			} else {
				outputs.set(identity, expression);
			}
			pending.delete(identity);
			resolvedThisRound.push(identity);
		}
		if (resolvedThisRound.length === 0) break;
		rounds.push(resolvedThisRound);
	}

	if (pending.size > 0) {
		const identities = [...pending.keys()].sort(compareAscii);
		throw diagnostic(
			"QP-EXEC-006",
			"recursiveOutputRequiresPin",
			identities[0],
			identities.map((identity) => pending.get(identity).origin),
			`Recursive output component requires an explicit output pin: ${identities.join(", ")}.`,
			[
				{
					description: "Add one explicit output codec at the cycle boundary.",
					command: null,
				},
			],
		);
	}

	return { outputs, rounds };
}

function operationProjection(definitions, outputs) {
	return definitions
		.map((definition) => {
			const kind = RESOURCE_KIND_BY_FACTORY[definition.factory];
			const identity = `${kind}:${definition.name}`;
			const output = outputs.get(identity);
			return {
				identity,
				kind,
				input: definition.input,
				output,
				outputSource: definition.outputPin ? "pin" : "inferred",
				slot: `${identity}/handler`,
				contractDigest: digest("questpie-p1-executable-contract-v1\0", {
					identity,
					input: definition.input,
					output,
				}),
			};
		})
		.sort((left, right) => compareAscii(left.identity, right.identity));
}

function runtimeBuild(
	definitions,
	slices,
	semanticArtifacts,
	buildInputDigest,
) {
	const slots = slices
		.map(({ runtime, runtimeGraphDigest }) => ({
			resourceIdentity: runtime.identity,
			kind: runtime.identity.slice(0, runtime.identity.indexOf(":")),
			slot: "handler",
			runtimeGraphDigest,
			bundleExport: runtime.identity.replace(/[^A-Za-z0-9]/g, "_"),
		}))
		.sort((left, right) =>
			compareAscii(left.resourceIdentity, right.resourceIdentity),
		);
	const runtimeGraphDigest = digest(
		"questpie-p1-runtime-graphs-v1\0",
		slots.map(({ resourceIdentity, runtimeGraphDigest: graph }) => ({
			resourceIdentity,
			runtimeGraphDigest: graph,
		})),
	);
	const withoutDigest = {
		format: "questpie.runtime-build",
		version: 1,
		applicationIdentity: "collaboration",
		buildInputDigest,
		manifestContentDigest: semanticArtifacts.manifestContentDigest,
		appContractContentDigest: semanticArtifacts.appContractContentDigest,
		runtimeGraphDigest,
		toolchain: {
			compilerVersion: "p1-proof",
			bunVersion: process.versions.bun,
			bundlerVersion: process.versions.bun,
		},
		slots,
		serverBundleDigest: digest(
			"questpie-p1-server-bundle-v1\0",
			definitions
				.map((definition) => ({
					identity: `${RESOURCE_KIND_BY_FACTORY[definition.factory]}:${definition.name}`,
					handler: definition.handler,
				}))
				.sort((left, right) => compareAscii(left.identity, right.identity)),
		),
	};
	return {
		...withoutDigest,
		digest: digest("questpie-runtime-build-v1\0", withoutDigest),
	};
}

function validateRuntimePair(expected, candidateSlots) {
	if (expected.digest !== candidateSlots.runtimeBuildDigest) {
		return { accepted: false, reason: "crossBuild" };
	}
	const counts = new Map();
	for (const slot of candidateSlots.slots) {
		counts.set(
			slot.resourceIdentity,
			(counts.get(slot.resourceIdentity) ?? 0) + 1,
		);
		const expectedSlot = expected.slots.find(
			(item) => item.resourceIdentity === slot.resourceIdentity,
		);
		if (!expectedSlot) return { accepted: false, reason: "stale" };
		if (expectedSlot.kind !== slot.kind) {
			return { accepted: false, reason: "wrongKind" };
		}
		if (expectedSlot.runtimeGraphDigest !== slot.runtimeGraphDigest) {
			return { accepted: false, reason: "stale" };
		}
	}
	for (const slot of expected.slots) {
		const count = counts.get(slot.resourceIdentity) ?? 0;
		if (count === 0) return { accepted: false, reason: "missing" };
		if (count > 1) return { accepted: false, reason: "duplicate" };
	}
	return { accepted: true, reason: null };
}

function resolveContextRoots(roots) {
	if (roots.length === 0) {
		return { identity: null, input: object({}), owner: null };
	}
	if (roots.length === 1) {
		return {
			identity: "context:app",
			input: roots[0].input,
			owner: "context:app",
			origin: roots[0].origin,
		};
	}
	throw diagnostic(
		"QP-EXEC-002",
		"duplicateContextRoot",
		"context:app",
		roots.map((root) => root.origin),
		"An application has more than one Context root.",
		[],
	);
}

function resolveDefaultPolicy(collectionIdentity, policies) {
	const candidates = policies
		.filter((candidate) => candidate.collection === collectionIdentity)
		.sort((left, right) => compareAscii(left.identity, right.identity));
	if (candidates.length === 0) {
		throw diagnostic(
			"QP-EXEC-003",
			"missingDefaultPolicy",
			collectionIdentity,
			[],
			`No default Policy is attached to ${collectionIdentity}.`,
			[],
		);
	}
	if (candidates.length > 1) {
		throw diagnostic(
			"QP-EXEC-004",
			"ambiguousDefaultPolicy",
			collectionIdentity,
			candidates.map((candidate) => candidate.origin),
			`More than one default Policy targets ${collectionIdentity}.`,
			[],
		);
	}
	return candidates[0];
}

function compileFixture({
	definitions = connectedDefinitions,
	discoveryOrder = "forward",
	checkoutRoot = "/proof/a",
	sourceMove = null,
} = {}) {
	const ordered =
		discoveryOrder === "reverse" ? [...definitions].reverse() : definitions;
	const normalizedDefinitions = ordered.map((definition) => {
		const origin =
			sourceMove && definition.name === sourceMove.name
				? { ...definition.origin, path: sourceMove.path }
				: definition.origin;
		return { ...definition, origin };
	});

	for (const factory of FACTORY_ALLOWLIST) {
		assert.deepEqual(substituteCurrentVirtualFactory(factory), {
			kind: "currentVirtualFactory",
			exportName: factory,
		});
	}
	assert.throws(() => substituteCurrentVirtualFactory("createApp"));
	assert.throws(() => substituteCurrentVirtualFactory("runtimeBindings"));

	const handlerOnlyInitializer = { count: 0 };
	const slices = normalizedDefinitions.map((definition) =>
		sliceDefinition(definition, handlerOnlyInitializer),
	);
	assert.equal(handlerOnlyInitializer.count, 0);

	const { outputs, rounds } = resolveOutputs(normalizedDefinitions);
	const operations = operationProjection(normalizedDefinitions, outputs);
	const children = expandOperationSet(operationSet);
	const allIdentities = [
		...operations.map((operation) => operation.identity),
		...children.map((child) => child.identity),
	];
	assert.equal(new Set(allIdentities).size, allIdentities.length);

	const manifestProjection = {
		format: "questpie.executable-projection",
		version: 1,
		application: "collaboration",
		context: resolveContextRoots([
			{
				input: object({ companyId: scalar("uuid") }),
				origin: appOrigin("src/context.ts", "appContext", 3),
			},
		]),
		operations,
		operationSetChildren: children.map(
			({ identity, owner, structuralContract, structuralContractDigest }) => ({
				identity,
				owner,
				structuralContract,
				structuralContractDigest,
			}),
		),
	};

	const appContractProjection = {
		format: "questpie.app-contract-projection",
		version: 1,
		serverMembers: [
			...operations.map(({ identity, input, output }) => ({
				identity,
				input,
				output,
			})),
			...children.map(({ identity, structuralContract }) => ({
				identity,
				input: { kind: "derivedCollectionOperationInput" },
				output: {
					kind: "derivedCollectionOperationOutput",
					structuralContract,
				},
			})),
		].sort((left, right) => compareAscii(left.identity, right.identity)),
		clientAliases: children
			.map((child) => ({
				alias: child.generatedAlias,
				resourceIdentity: child.identity,
			}))
			.sort((left, right) => compareAscii(left.alias, right.alias)),
	};

	const originMap = {
		format: "questpie.origin-map",
		version: 1,
		buildInputDigest: "filled-after-build-input",
		packages: [],
		resources: [
			...normalizedDefinitions.map((definition) => {
				const kind = RESOURCE_KIND_BY_FACTORY[definition.factory];
				return {
					identity: `${kind}:${definition.name}`,
					establishedAt: definition.origin,
					handlerAt: definition.handlerOrigin ?? definition.origin,
					augmentations: [],
					members: [],
				};
			}),
			...children.map((child) => ({
				identity: child.identity,
				establishedAt: child.origin,
				handlerAt: null,
				augmentations: [],
				members: [],
			})),
		].sort((left, right) => compareAscii(left.identity, right.identity)),
	};

	const structuralGraph = normalizedDefinitions
		.map((definition) => ({
			path: definition.origin.path,
			contentDigest: digest("questpie-p1-source-v1\0", {
				factory: definition.factory,
				name: definition.name,
				input: definition.input,
				outputPin: definition.outputPin ?? null,
			}),
		}))
		.sort((left, right) => compareAscii(left.path, right.path));
	const buildInput = {
		checkoutRootExcluded: true,
		logicalApplication: "collaboration",
		structuralGraph,
	};
	const buildInputDigest = digest("questpie-p1-build-input-v1\0", buildInput);
	originMap.buildInputDigest = buildInputDigest;

	const semanticArtifacts = {
		manifestContentDigest: digest(
			"questpie-p1-executable-projection-v1\0",
			manifestProjection,
		),
		appContractContentDigest: digest(
			"questpie-p1-app-contract-v1\0",
			appContractProjection,
		),
	};
	const runtime = runtimeBuild(
		normalizedDefinitions,
		slices,
		semanticArtifacts,
		buildInputDigest,
	);

	const packageInventory = [
		{
			exportName: "auditEvent",
			category: "definition",
			resourceKind: "query",
			identity: "query:acme.audit.event",
			structuralContractDigest: digest("questpie-structural-contract-v1\0", {
				input: object({ sequence: scalar("integer") }),
				output: nullable(
					object({ sequence: scalar("integer"), subject: scalar("text") }),
				),
			}),
			origin: packageOrigin("src/audit-event.ts", "auditEvent", 4),
		},
		...children.map((child) => ({
			exportName: "messageOperations",
			category: "definition",
			resourceKind: child.identity.slice(0, child.identity.indexOf(":")),
			identity: child.identity,
			structuralContractDigest: child.structuralContractDigest,
			origin: child.origin,
		})),
	].sort((left, right) =>
		compareAscii(
			`${left.category}\0${left.identity}\0${left.exportName}`,
			`${right.category}\0${right.identity}\0${right.exportName}`,
		),
	);

	const explain = {
		format: "questpie.explain",
		version: 1,
		identity: "mutation:messages.rename",
		owner: "mutation:messages.rename",
		origin: originMap.resources.find(
			(resource) => resource.identity === "mutation:messages.rename",
		).establishedAt,
		contract: operations.find(
			(operation) => operation.identity === "mutation:messages.rename",
		),
		executable: runtime.slots.find(
			(slot) => slot.resourceIdentity === "mutation:messages.rename",
		),
		runtimeBuildDigest: runtime.digest,
		foundationalDigests: FOUNDATIONAL_DIGESTS,
	};

	void checkoutRoot;
	return {
		foundationalDigests: FOUNDATIONAL_DIGESTS,
		manifestProjection,
		appContractProjection,
		originMap,
		buildInputDigest,
		semanticArtifacts,
		runtime,
		packageInventory,
		explain,
		rounds,
		slices,
	};
}

function assertCollision(children) {
	const handwritten = {
		identity: "mutation:messages.update",
		origin: appOrigin(
			"src/features/messages/custom-update.ts",
			"customUpdate",
			3,
		),
	};
	const child = children.find((item) => item.identity === handwritten.identity);
	assert.ok(child);
	const result = diagnostic(
		"QP-COMPOSE-002",
		"duplicateResourceIdentity",
		handwritten.identity,
		[child.origin, handwritten.origin],
		`Two establishing sources claim ${handwritten.identity}.`,
		[],
	);
	assert.equal(result.origins.length, 2);
	return result;
}

function runOutputCycleProof() {
	const cycle = [
		{
			factory: "defineQuery",
			name: "cycle.a",
			input: object({}),
			outputExpression: ref("query:cycle.b"),
			handler: "cycle-a",
			lexicalDependencies: [],
			origin: appOrigin("src/cycle-a.ts", "cycleA", 1),
		},
		{
			factory: "defineQuery",
			name: "cycle.b",
			input: object({}),
			outputExpression: ref("query:cycle.a"),
			handler: "cycle-b",
			lexicalDependencies: [],
			origin: appOrigin("src/cycle-b.ts", "cycleB", 1),
		},
	];
	assert.throws(
		() => resolveOutputs(cycle),
		(error) =>
			error.code === "QP-EXEC-006" &&
			error.class === "recursiveOutputRequiresPin" &&
			error.origins.length === 2,
	);
	const pin = object({ value: scalar("text") });
	const pinned = cycle.map((definition) =>
		definition.name === "cycle.a"
			? { ...definition, outputPin: pin }
			: definition,
	);
	const resolved = resolveOutputs(pinned);
	assert.deepEqual(resolved.outputs.get("query:cycle.a"), pin);
	assert.deepEqual(resolved.outputs.get("query:cycle.b"), pin);
	assert.deepEqual(resolved.rounds, [["query:cycle.b"]]);
}

function runFreshnessProof() {
	const currentBuildInputDigest = digest("questpie-p1-current-input-v1\0", {
		resource: "query:messages.summary",
		collections: ["messages"],
	});
	const staleDisk = {
		buildInputDigest: digest("questpie-p1-current-input-v1\0", {
			resource: "query:messages.summary",
			collections: ["legacy", "messages"],
		}),
		declarations: "legacy-is-visible-only-to-raw-tsc",
	};
	assert.notEqual(staleDisk.buildInputDigest, currentBuildInputDigest);
	const check = {
		uses: "currentVirtualContract",
		accepted: false,
		diagnostic: diagnostic(
			"QP-COMPOSE-018",
			"generatedOutputStale",
			null,
			[],
			"Generated output does not match the current Build Input.",
			[
				{
					description: "Synchronize the application.",
					command: "bunx questpie sync",
				},
			],
		),
	};
	assert.equal(check.uses, "currentVirtualContract");
	assert.equal(check.accepted, false);
	return { currentBuildInputDigest, staleDisk, check };
}

export function runP1Goldens() {
	const baseline = compileFixture();
	const reversed = compileFixture({ discoveryOrder: "reverse" });
	const relocated = compileFixture({
		checkoutRoot: "/different/absolute/checkout",
	});

	assert.equal(
		bytes(baseline.manifestProjection),
		bytes(reversed.manifestProjection),
	);
	assert.equal(bytes(baseline.runtime), bytes(reversed.runtime));
	assert.equal(bytes(baseline.originMap), bytes(reversed.originMap));
	assert.equal(
		bytes(baseline.manifestProjection),
		bytes(relocated.manifestProjection),
	);
	assert.equal(bytes(baseline.runtime), bytes(relocated.runtime));
	assert.equal(bytes(baseline.originMap), bytes(relocated.originMap));
	const slicing = proveHandlerSlicingParity();

	const moved = compileFixture({
		sourceMove: {
			name: "messages.rename",
			path: "src/renamed-feature/rename.ts",
		},
	});
	assert.equal(
		bytes(baseline.manifestProjection),
		bytes(moved.manifestProjection),
	);
	assert.notEqual(bytes(baseline.originMap), bytes(moved.originMap));
	assert.notEqual(baseline.buildInputDigest, moved.buildInputDigest);

	const bodyChangedDefinitions = connectedDefinitions.map((definition) =>
		definition.name === "messages.rename"
			? { ...definition, handler: "inline:messages.rename:v2-body-only" }
			: definition,
	);
	const bodyChanged = compileFixture({ definitions: bodyChangedDefinitions });
	assert.equal(
		bytes(baseline.manifestProjection),
		bytes(bodyChanged.manifestProjection),
	);
	assert.equal(
		baseline.semanticArtifacts.appContractContentDigest,
		bodyChanged.semanticArtifacts.appContractContentDigest,
	);
	assert.notEqual(baseline.runtime.digest, bodyChanged.runtime.digest);
	assert.deepEqual(
		baseline.foundationalDigests,
		bodyChanged.foundationalDigests,
	);

	const changedOutput = object({
		id: scalar("uuid"),
		body: scalar("text"),
		updatedAt: scalar("timestamp"),
		version: scalar("integer"),
	});
	const outputChangedDefinitions = connectedDefinitions.map((definition) =>
		definition.name === "messages.rename"
			? {
					...definition,
					handler: "inline:messages.rename:v3-return-shape",
					outputExpression: nullable(changedOutput),
				}
			: definition,
	);
	const outputChanged = compileFixture({
		definitions: outputChangedDefinitions,
	});
	assert.notEqual(
		baseline.semanticArtifacts.manifestContentDigest,
		outputChanged.semanticArtifacts.manifestContentDigest,
	);
	assert.notEqual(
		baseline.semanticArtifacts.appContractContentDigest,
		outputChanged.semanticArtifacts.appContractContentDigest,
	);
	assert.notEqual(baseline.runtime.digest, outputChanged.runtime.digest);

	const originalRename = connectedDefinitions.find(
		(definition) => definition.name === "messages.rename",
	);
	const pinnedDefinitions = connectedDefinitions.map((definition) =>
		definition.name === "messages.rename"
			? { ...definition, outputPin: definition.outputExpression }
			: definition,
	);
	const pinned = compileFixture({ definitions: pinnedDefinitions });
	const originalCodec = baseline.manifestProjection.operations.find(
		(operation) => operation.identity === "mutation:messages.rename",
	).output;
	const pinnedCodec = pinned.manifestProjection.operations.find(
		(operation) => operation.identity === "mutation:messages.rename",
	).output;
	assert.deepEqual(originalCodec, originalRename.outputExpression);
	assert.equal(bytes(originalCodec), bytes(pinnedCodec));

	runOutputCycleProof();
	const freshness = runFreshnessProof();

	const children = expandOperationSet(operationSet);
	assert.equal(children.length, 5);
	assert.deepEqual(
		children.map((child) => child.identity),
		[
			"mutation:messages.create",
			"mutation:messages.delete",
			"query:messages.get",
			"query:messages.list",
			"mutation:messages.update",
		].sort(compareAscii),
	);
	for (const child of children) {
		assert.equal(child.owner, child.identity);
		assert.ok(child.origin.member);
		assert.ok(child.generatedAlias.startsWith("collections.messages."));
		assert.equal(
			baseline.packageInventory.filter(
				(item) => item.identity === child.identity,
			).length,
			1,
		);
	}
	const collision = assertCollision(children);

	assert.deepEqual(resolveContextRoots([]), {
		identity: null,
		input: object({}),
		owner: null,
	});
	assert.equal(
		resolveContextRoots([
			{
				input: object({ companyId: scalar("uuid") }),
				origin: appOrigin("src/context.ts", "appContext", 1),
			},
		]).identity,
		"context:app",
	);
	assert.throws(
		() =>
			resolveContextRoots([
				{
					input: object({}),
					origin: appOrigin("src/context-a.ts", "first", 1),
				},
				{
					input: object({}),
					origin: appOrigin("src/context-b.ts", "second", 1),
				},
			]),
		(error) => error.code === "QP-EXEC-002" && error.origins.length === 2,
	);

	const messagePolicy = {
		identity: "policy:messages.default",
		collection: "collection:messages",
		origin: appOrigin("src/policies/messages.ts", "messagePolicy", 3),
	};
	assert.throws(
		() => resolveDefaultPolicy("collection:messages", []),
		(error) => error.code === "QP-EXEC-003",
	);
	assert.equal(
		resolveDefaultPolicy("collection:messages", [messagePolicy]).identity,
		"policy:messages.default",
	);
	assert.throws(
		() =>
			resolveDefaultPolicy("collection:messages", [
				messagePolicy,
				{
					identity: "policy:messages.alternate",
					collection: "collection:messages",
					origin: appOrigin("src/policies/messages-alt.ts", "alternate", 3),
				},
			]),
		(error) => error.code === "QP-EXEC-004" && error.origins.length === 2,
	);

	const validBindings = {
		runtimeBuildDigest: baseline.runtime.digest,
		slots: baseline.runtime.slots.map((slot) => ({ ...slot })),
	};
	assert.deepEqual(validateRuntimePair(baseline.runtime, validBindings), {
		accepted: true,
		reason: null,
	});
	const missing = { ...validBindings, slots: validBindings.slots.slice(1) };
	assert.equal(
		validateRuntimePair(baseline.runtime, missing).reason,
		"missing",
	);
	const duplicate = {
		...validBindings,
		slots: [...validBindings.slots, validBindings.slots[0]],
	};
	assert.equal(
		validateRuntimePair(baseline.runtime, duplicate).reason,
		"duplicate",
	);
	const stale = {
		...validBindings,
		slots: validBindings.slots.map((slot, index) =>
			index === 0 ? { ...slot, runtimeGraphDigest: "0".repeat(64) } : slot,
		),
	};
	assert.equal(validateRuntimePair(baseline.runtime, stale).reason, "stale");
	const wrongKind = {
		...validBindings,
		slots: validBindings.slots.map((slot, index) =>
			index === 0 ? { ...slot, kind: "query" } : slot,
		),
	};
	if (wrongKind.slots[0].kind === baseline.runtime.slots[0].kind) {
		wrongKind.slots[0].kind = "mutation";
	}
	assert.equal(
		validateRuntimePair(baseline.runtime, wrongKind).reason,
		"wrongKind",
	);
	assert.equal(
		validateRuntimePair(baseline.runtime, {
			...validBindings,
			runtimeBuildDigest: "f".repeat(64),
		}).reason,
		"crossBuild",
	);

	const publicGoldens = {
		manifestDigest: baseline.semanticArtifacts.manifestContentDigest,
		appContractDigest: baseline.semanticArtifacts.appContractContentDigest,
		runtimeBuildDigest: baseline.runtime.digest,
		packageInventoryDigest: digest(
			"questpie-package-inventory-v1\0",
			baseline.packageInventory.map(({ origin, ...entry }) => entry),
		),
		explainDigest: digest("questpie-explain-v1\0", baseline.explain),
	};

	const proofDirectory = path.dirname(new URL(import.meta.url).pathname);
	const generatedApp = readFileSync(
		path.join(proofDirectory, "types", "generated", "app.ts"),
		"utf8",
	);
	const generatedClient = readFileSync(
		path.join(proofDirectory, "types", "generated", "client.ts"),
		"utf8",
	);
	for (const factory of FACTORY_ALLOWLIST) {
		assert.ok(generatedApp.includes(`export const ${factory}:`));
	}
	for (const operation of baseline.manifestProjection.operations) {
		assert.ok(
			generatedApp.includes(
				operation.identity.slice(operation.identity.indexOf(":") + 1),
			),
		);
	}
	for (const child of baseline.manifestProjection.operationSetChildren) {
		assert.ok(
			generatedApp.includes(
				child.identity.slice(child.identity.indexOf(":") + 1),
			),
		);
	}
	for (const member of ["list", "get", "create", "update", "delete"]) {
		assert.ok(generatedClient.includes(`readonly ${member}:`));
	}
	assert.equal(
		/\b(?:any|unknown)\b|typeof import|QuestpieApp/.test(
			generatedApp + generatedClient,
		),
		false,
	);

	const expectedGoldens = {
		manifestDigest:
			"c806791a7522305ed2f2554613eb06fc331528501c31fc5e5f106753b2a0a644",
		appContractDigest:
			"d6052edc32d5a9218f242d724c7b47dd0ea543857d57fe5f47bc625fb307b7ca",
		runtimeBuildDigest:
			"ff060e1cf02fb28830e8fee2aa89a90bfe777468e7e84bbbe6a31b81cea3db19",
		packageInventoryDigest:
			"ab70ed96877f03aef868ebbed7503138cbd33503b935bbfeaa022f4e1164d71b",
		explainDigest:
			"3224211500c7a38bc639a7e3d1cc3001129d6e498ccae3a89512e146d359a499",
	};
	if (process.env.QUESTPIE_PRINT_P1_GOLDENS === "1") {
		console.log(JSON.stringify(publicGoldens, null, 2));
	} else {
		assert.deepEqual(publicGoldens, expectedGoldens);
	}

	return {
		publicGoldens,
		baseline,
		freshness,
		collision,
		slicing,
	};
}

if (import.meta.main) {
	runP1Goldens();
	console.log("P1 executable Definition compiler goldens: pass");
}
