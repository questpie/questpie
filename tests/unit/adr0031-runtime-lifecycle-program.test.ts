import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { normalizeExecutedOperationError } from "../../packages/runtime/src/application/operation-error";
import {
	collectionLifecycleIssueIdentity,
	executeCollectionLifecyclePhase,
	isCollectionLifecycleIssue,
	linkCollectionMutationPrograms,
} from "../../packages/runtime/src/mutation";
import { canonicalMutationBytes } from "../../packages/runtime/src/mutation/canonical";
import {
	captureCollectionLifecycleIssue,
	createCollectionLifecycleDoom,
} from "../../packages/runtime/src/mutation/lifecycle";
import { OperationFailure } from "../../packages/runtime/src/operation";

function digest(domain: string, value: unknown): string {
	return createHash("sha256")
		.update(`${domain}\0`)
		.update(canonicalMutationBytes(value))
		.digest("hex");
}

const runtimeBuild = "b".repeat(64);
const bindings = {
	schema: "schema:teamSupportDesk",
	collection: "collection:tickets",
	fields: {
		reference: "collection:tickets/field:reference",
		summary: "collection:tickets/field:summary",
	},
	issues: { invalidReference: "issue:tickets/invalidReference" },
	capabilities: {},
	operations: ["mutation:ticket.create"],
	jobs: [],
} as const;
const lifecycleContract = {
	format: "questpie.lifecycle-program.v1",
	interpreter: "questpie.lifecycle-interpreter.v1",
	runtimeBuild,
	reentryLimit: 8,
	bindings,
	phases: {
		normalize: [
			{
				op: "return",
				value: {
					op: "object",
					entries: [
						{ kind: "spreadInput" },
						{
							kind: "field",
							field: "collection:tickets/field:reference",
							value: {
								op: "stringMethod",
								method: "trim",
								target: {
									op: "member",
									target: { op: "root", root: "input" },
									field: "collection:tickets/field:reference",
									optional: false,
								},
								arguments: [],
								optional: false,
							},
						},
					],
				},
			},
		],
		validate: [
			{
				op: "if",
				test: {
					op: "unary",
					operator: "!",
					value: {
						op: "stringMethod",
						method: "startsWith",
						target: {
							op: "member",
							target: { op: "root", root: "candidate" },
							field: "collection:tickets/field:reference",
							optional: false,
						},
						arguments: [{ op: "literal", value: "SUP-" }],
						optional: false,
					},
				},
				consequent: [
					{
						op: "throwIssue",
						issue: "issue:tickets/invalidReference",
					},
				],
				otherwise: [],
			},
		],
		check: [],
		afterWrite: [],
	},
} as const;
const lifecycle = {
	...lifecycleContract,
	digest: digest("questpie.collection-lifecycle-program.v1", lifecycleContract),
} as const;
const lifecyclePrograms = {
	format: "questpie.collection-lifecycle-programs",
	version: 1,
	programs: [lifecycle],
} as const;
const lifecycleProgramsDigest = digest(
	"questpie.collection-lifecycle-programs-v1",
	lifecyclePrograms,
);

const operation = {
	identity: "mutation:__collectionKernel.tickets.create",
	kind: "mutation",
	mode: "writeTransaction",
	target: "collection:tickets",
	member: "create",
	policy: "policy:tickets.default",
	keyFields: [],
	callerInputFields: [["reference"], ["summary"]],
	requiredCallerInputFields: [["reference"], ["summary"]],
	trustedValueFields: [["reference"], ["summary"]],
	requiredTrustedValueFields: [],
	selectedFieldPaths: [["reference"], ["summary"]],
	dataQuery: null,
	dataQueryDigest: null,
	normalizerProgramDigest: null,
	serverValueProgramDigest: null,
	lifecycleProgramDigest: lifecycle.digest,
	outputCardinality: "one",
	limits: {
		inputBytes: 65_536,
		resultBytes: 1_048_576,
		rowsWritten: 100,
		durationMilliseconds: 5_000,
	},
} as const;

test("links and interprets an artifact-bound Collection lifecycle without callbacks", async () => {
	const linked = linkCollectionMutationPrograms({
		collectionOperations: {
			format: "questpie.collection-operation-programs",
			version: 1,
			operations: [operation],
		},
		fieldNormalizers: {
			format: "questpie.field-normalizer-programs",
			version: 1,
			programs: [],
		},
		serverValues: {
			format: "questpie.server-value-programs",
			version: 1,
			programs: [],
		},
		lifecyclePrograms,
		expectedLifecycleProgramsDigest: lifecycleProgramsDigest,
		compilerRuntimeBuildDigest: runtimeBuild,
		policies: [
			{ identity: "policy:tickets.default", target: "collection:tickets" },
		],
	});
	const program = linked.byIdentity.get(operation.identity)!;
	expect(program.lifecycleProgram?.bindings).toEqual(bindings);
	await expect(
		executeCollectionLifecyclePhase(program.lifecycleProgram!, "normalize", {
			input: { reference: "  SUP-123  ", summary: "Help" },
		}),
	).resolves.toEqual({ reference: "SUP-123", summary: "Help" });
	let caught: unknown;
	try {
		await executeCollectionLifecyclePhase(
			program.lifecycleProgram!,
			"validate",
			{
				candidate: { reference: "BAD-123", summary: "Help" },
				current: null,
				now: new Date("2026-08-29T10:00:00.000Z"),
			},
		);
	} catch (error) {
		caught = error;
	}
	expect(isCollectionLifecycleIssue(caught)).toBe(true);
	expect(collectionLifecycleIssueIdentity(caught)).toBe(
		"issue:tickets/invalidReference",
	);
	const forged = Object.assign(new Error("Collection lifecycle issue"), {
		[Symbol.for("questpie.runtime.collection-lifecycle-issue.v1")]: true,
		identity: "issue:tickets/invalidReference",
		name: "CollectionLifecycleIssue",
	});
	expect(isCollectionLifecycleIssue(forged)).toBe(false);
	expect(collectionLifecycleIssueIdentity(forged)).toBeNull();
	expect(isCollectionLifecycleIssue(Object.create(caught as object))).toBe(
		false,
	);
	const normalized = normalizeExecutedOperationError(
		{
			declaredErrors: [],
			issueMappings: { "collection:tickets": null },
		} as never,
		caught,
	);
	expect(normalized).toEqual(new OperationFailure("INTERNAL"));
	expect(Object.getOwnPropertyNames(normalized).sort()).toEqual([
		"code",
		"retryable",
	]);
});

test("fails closed on compiler-only afterWrite capabilities before LIFE-05 runtime execution", () => {
	const capabilityContract = {
		...lifecycleContract,
		bindings: {
			...bindings,
			capabilities: {
				"data.tickets.update": {
					kind: "write",
					identity: "mutation:__collectionKernel.tickets.update",
					argumentKeys: ["key", "patch", "values"],
				},
			},
			operations: [
				"mutation:ticket.create",
				"mutation:__collectionKernel.tickets.update",
			],
		},
		phases: {
			...lifecycleContract.phases,
			afterWrite: [
				{
					op: "effect",
					value: {
						op: "capability",
						capability: "write",
						identity: "mutation:__collectionKernel.tickets.update",
						arguments: [],
					},
				},
			],
		},
	} as const;
	const capabilityLifecycle = {
		...capabilityContract,
		digest: digest(
			"questpie.collection-lifecycle-program.v1",
			capabilityContract,
		),
	} as const;
	const capabilityPrograms = {
		format: "questpie.collection-lifecycle-programs",
		version: 1,
		programs: [capabilityLifecycle],
	} as const;
	expect(() =>
		linkCollectionMutationPrograms({
			collectionOperations: {
				format: "questpie.collection-operation-programs",
				version: 1,
				operations: [
					{ ...operation, lifecycleProgramDigest: capabilityLifecycle.digest },
				],
			},
			fieldNormalizers: {
				format: "questpie.field-normalizer-programs",
				version: 1,
				programs: [],
			},
			serverValues: {
				format: "questpie.server-value-programs",
				version: 1,
				programs: [],
			},
			lifecyclePrograms: capabilityPrograms,
			expectedLifecycleProgramsDigest: digest(
				"questpie.collection-lifecycle-programs-v1",
				capabilityPrograms,
			),
			compilerRuntimeBuildDigest: runtimeBuild,
			policies: [
				{ identity: "policy:tickets.default", target: "collection:tickets" },
			],
		}),
	).toThrow("afterWrite statement 0 op is invalid");
});

test("normalizes a sparse lane with ordinary optional-chain semantics", async () => {
	const sparse = {
		...lifecycle,
		phases: {
			...lifecycle.phases,
			normalize: [
				{
					op: "return",
					value: {
						op: "conditional",
						test: {
							op: "stringMethod",
							method: "includes",
							target: {
								op: "member",
								target: { op: "root", root: "input" },
								field: "collection:tickets/field:reference",
								optional: false,
							},
							arguments: [{ op: "literal", value: "" }],
							optional: true,
						},
						yes: { op: "literal", value: "wrong branch" },
						no: { op: "root", root: "input" },
					},
				},
			],
		},
	} as never;

	await expect(
		executeCollectionLifecyclePhase(sparse, "normalize", {
			input: { summary: "trusted lane without reference" },
		}),
	).resolves.toEqual({ summary: "trusted lane without reference" });
	await expect(
		executeCollectionLifecyclePhase(lifecycle as never, "normalize", {
			input: { reference: new Map(), summary: "open runtime value" },
		}),
	).rejects.toThrow("not closed");
});

test("treats an omitted normalize phase as the identity program", async () => {
	await expect(
		executeCollectionLifecyclePhase(
			{
				...lifecycle,
				phases: { ...lifecycle.phases, normalize: [] },
			} as never,
			"normalize",
			{ input: { reference: "SUP-123", summary: "Help" } },
		),
	).resolves.toEqual({ reference: "SUP-123", summary: "Help" });
});

test("keeps the first lifecycle Issue and dooms work after application catch", async () => {
	const doom = createCollectionLifecycleDoom();
	for (const issue of [
		"issue:tickets/invalidReference",
		"issue:tickets/secondIssue",
	] as const) {
		try {
			await captureCollectionLifecycleIssue(doom, () =>
				executeCollectionLifecyclePhase(
					{
						...lifecycle,
						bindings: {
							...lifecycle.bindings,
							issues: {
								...lifecycle.bindings.issues,
								secondIssue: "issue:tickets/secondIssue",
							},
						},
						phases: {
							...lifecycle.phases,
							validate: [{ op: "throwIssue", issue }],
						},
					} as never,
					"validate",
					{
						candidate: { reference: "BAD", summary: "caught" },
						current: null,
						now: new Date("2026-08-29T10:00:00.000Z"),
					},
				),
			);
		} catch {
			// Application code may catch, but the transaction owner stays doomed.
		}
	}
	let doomed: unknown;
	try {
		doom.throwIfDoomed();
	} catch (error) {
		doomed = error;
	}
	expect(collectionLifecycleIssueIdentity(doomed)).toBe(
		"issue:tickets/invalidReference",
	);
});

test("rejects lifecycle digest and Runtime Build drift", () => {
	for (const hostile of [
		{ ...lifecycle, digest: "0".repeat(64) },
		{ ...lifecycle, runtimeBuild: "0".repeat(64) },
		{ ...lifecycle, callback: () => undefined },
	])
		expect(() =>
			linkCollectionMutationPrograms({
				collectionOperations: {
					format: "questpie.collection-operation-programs",
					version: 1,
					operations: [operation],
				},
				fieldNormalizers: {
					format: "questpie.field-normalizer-programs",
					version: 1,
					programs: [],
				},
				serverValues: {
					format: "questpie.server-value-programs",
					version: 1,
					programs: [],
				},
				lifecyclePrograms: {
					format: "questpie.collection-lifecycle-programs",
					version: 1,
					programs: [hostile],
				},
				expectedLifecycleProgramsDigest: lifecycleProgramsDigest,
				compilerRuntimeBuildDigest: runtimeBuild,
				policies: [
					{
						identity: "policy:tickets.default",
						target: "collection:tickets",
					},
				],
			}),
		).toThrow(/lifecycle|Runtime Build|digest|canonical/i);

	for (const driftedBindings of [
		{ ...bindings, schema: "schema:drifted" },
		{ ...bindings, operations: ["mutation:ticket.other"] },
	]) {
		const contract = { ...lifecycleContract, bindings: driftedBindings };
		const resigned = {
			...contract,
			digest: digest("questpie.collection-lifecycle-program.v1", contract),
		};
		expect(() =>
			linkCollectionMutationPrograms({
				collectionOperations: {
					format: "questpie.collection-operation-programs",
					version: 1,
					operations: [
						{ ...operation, lifecycleProgramDigest: resigned.digest },
					],
				},
				fieldNormalizers: {
					format: "questpie.field-normalizer-programs",
					version: 1,
					programs: [],
				},
				serverValues: {
					format: "questpie.server-value-programs",
					version: 1,
					programs: [],
				},
				lifecyclePrograms: {
					format: "questpie.collection-lifecycle-programs",
					version: 1,
					programs: [resigned],
				},
				expectedLifecycleProgramsDigest: lifecycleProgramsDigest,
				compilerRuntimeBuildDigest: runtimeBuild,
				policies: [
					{
						identity: "policy:tickets.default",
						target: "collection:tickets",
					},
				],
			}),
		).toThrow(/lifecycle program envelope digest/i);
	}
});
