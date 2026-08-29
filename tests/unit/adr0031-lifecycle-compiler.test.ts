import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
	compileApplication,
	CompilerDiagnosticError,
} from "@questpie/compiler";

import { traceIssueReachability } from "../../packages/compiler/src/lifecycle/reachability";

const fixtureRoot = resolve(
	import.meta.dir,
	"../../fixtures/team-support-desk",
);
const collaborationRoot = resolve(
	import.meta.dir,
	"../../fixtures/collaboration",
);

test("traces nested Collection calls deterministically without looping on re-entry", () => {
	const origin = { module: "src/messages.ts", line: 1, column: 1 };
	const nodes = new Map([
		[
			"collection:messages/create",
			{
				identity: "collection:messages/create",
				issues: [],
				calls: ["collection:messageEvents/create"],
			},
		],
		[
			"collection:messageEvents/create",
			{
				identity: "collection:messageEvents/create",
				issues: [],
				calls: ["collection:limits/create"],
			},
		],
		[
			"collection:limits/create",
			{
				identity: "collection:limits/create",
				issues: [
					{
						issue: "issue:limits/exceeded" as const,
						phase: "validate" as const,
						origin,
					},
				],
				calls: ["collection:messages/create"],
			},
		],
	] as const);
	expect(
		traceIssueReachability("collection:messages/create", nodes).get(
			"issue:limits/exceeded",
		),
	).toMatchObject({
		path: [
			"collection:messages/create",
			"collection:messageEvents/create",
			"collection:limits/create",
		],
		phase: "validate",
		origin,
	});
});

test("compiles Team Support Desk lifecycle authoring without retaining callbacks", async () => {
	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	const committedSchema = await readFile(
		join(fixtureRoot, ".questpie/generated/schema-projection.json"),
		"utf8",
	);
	expect(compilation.generatedFiles["schema-projection.json"]).toBe(
		committedSchema,
	);

	const artifactBytes =
		compilation.generatedFiles["collection-lifecycle-programs.json"]!;
	const artifacts = JSON.parse(artifactBytes) as Readonly<{
		format: string;
		version: number;
		programs: readonly Readonly<{
			format: string;
			interpreter: string;
			runtimeBuild: string;
			digest: string;
			bindings: Readonly<{
				collection: string;
				issues: Readonly<Record<string, string>>;
				operations: readonly string[];
			}>;
			phases: Readonly<Record<string, readonly unknown[]>>;
		}>[];
	}>;
	expect(artifacts.format).toBe("questpie.collection-lifecycle-programs");
	expect(artifacts.version).toBe(1);
	const tickets = artifacts.programs.find(
		(program) => program.bindings.collection === "collection:tickets",
	);
	expect(tickets).toEqual(
		expect.objectContaining({
			format: "questpie.lifecycle-program.v1",
			interpreter: "questpie.lifecycle-interpreter.v1",
			runtimeBuild: expect.stringMatching(/^[a-f0-9]{64}$/),
			digest: expect.stringMatching(/^[a-f0-9]{64}$/),
		}),
	);
	expect(tickets?.bindings.issues).toEqual({
		invalidReference: "issue:tickets/invalidReference",
	});
	expect(tickets?.bindings.operations).toContain("mutation:ticket.create");
	expect(tickets?.phases.normalize.length).toBeGreaterThan(0);
	expect(tickets?.phases.validate.length).toBeGreaterThan(0);
	expect(tickets?.phases.check).toEqual([]);
	expect(tickets?.phases.afterWrite).toEqual([]);
	expect(artifactBytes).not.toContain("=>");
	expect(artifactBytes).not.toContain(
		"AUTHORED_LIFECYCLE_CALLBACK_MUST_NOT_SHIP",
	);
	expect(compilation.generatedFiles["internal/application.js"]).not.toContain(
		"AUTHORED_LIFECYCLE_CALLBACK_MUST_NOT_SHIP",
	);
	const envelopeDigest = createHash("sha256")
		.update("questpie.collection-lifecycle-programs-v1\0")
		.update(artifactBytes)
		.digest("hex");
	expect(compilation.generatedFiles["internal/application.js"]).toContain(
		envelopeDigest,
	);

	const kernels = JSON.parse(
		compilation.generatedFiles["collection-operation-programs.json"]!,
	) as Readonly<{
		operations: readonly Readonly<{
			target: string;
			member: string;
			lifecycleProgramDigest: string | null;
		}>[];
	}>;
	expect(
		kernels.operations
			.filter(
				({ target, member }) =>
					target === "collection:tickets" &&
					(member === "create" || member === "update"),
			)
			.map(({ member, lifecycleProgramDigest }) => ({
				member,
				lifecycleProgramDigest,
			})),
	).toEqual([
		{ member: "create", lifecycleProgramDigest: tickets?.digest },
		{ member: "update", lifecycleProgramDigest: tickets?.digest },
	]);
	const runtimeBuild = JSON.parse(
		compilation.generatedFiles["runtime-build.json"]!,
	) as Readonly<{
		compilerRuntimeBuildDigest: string;
		inventory: readonly Readonly<{ path: string; digest: string }>[];
	}>;
	expect(tickets?.runtimeBuild).toBe(runtimeBuild.compilerRuntimeBuildDigest);
	expect(runtimeBuild.inventory).toContainEqual(
		expect.objectContaining({
			path: "collection-lifecycle-programs.json",
		}),
	);
	const postgresPlans = JSON.parse(
		compilation.generatedFiles["postgres-collection-operation-plans.json"]!,
	) as Readonly<{
		plans: readonly Readonly<{
			target: string;
			member: string;
			candidateValidation?: Readonly<{
				parameters: readonly Readonly<{ kind: string }>[];
			}>;
			write: Readonly<{
				parameters: readonly Readonly<{ kind: string }>[];
			}>;
		}>[];
	}>;
	const createPlan = postgresPlans.plans.find(
		({ target, member }) =>
			target === "collection:tickets" && member === "create",
	)!;
	expect(createPlan.candidateValidation).toBeDefined();
	expect(createPlan.write.parameters).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ kind: "candidateValue" }),
		]),
	);
	const operationContracts = JSON.parse(
		compilation.generatedFiles["operation-contracts.json"]!,
	) as Readonly<{
		operations: readonly Readonly<{
			identity: string;
			issueMappings?: Readonly<
				Record<string, Readonly<Record<string, string>>>
			>;
		}>[];
	}>;
	expect(
		operationContracts.operations.find(
			({ identity }) => identity === "mutation:ticket.create",
		)?.issueMappings,
	).toEqual({
		"collection:tickets": {
			"issue:tickets/invalidReference": "invalidTicket",
		},
	});

	const app = compilation.generatedFiles["app.ts"]!;
	expect(app).toContain('readonly "invalidReference": "invalidTicket";');
	expect(app).toContain(
		'issueMappings?: GeneratedMutations[Name]["issueMappings"]',
	);
}, 30_000);

test("projects explicit issue ownership for a generated named Mutation", async () => {
	const compilation = await compileApplication({
		applicationRoot: collaborationRoot,
	});
	const contracts = JSON.parse(
		compilation.generatedFiles["operation-contracts.json"]!,
	) as Readonly<{
		operations: readonly Readonly<{
			identity: string;
			declaredErrors: Readonly<Record<string, unknown>>;
			issueMappings?: Readonly<Record<string, unknown>>;
		}>[];
	}>;
	expect(
		contracts.operations.find(
			({ identity }) => identity === "mutation:messageEvents.create",
		),
	).toMatchObject({
		declaredErrors: {
			invalidMessageEvent: {
				code: "INVALID_MESSAGE_EVENT",
				status: 422,
				payload: null,
			},
		},
		issueMappings: {
			"collection:messageEvents": {
				"issue:messageEvents/invalidKind": "invalidMessageEvent",
			},
		},
	});
}, 30_000);

test("rejects an unmapped issue-bearing generated named Mutation", async () => {
	const temporary = await mkdtemp(
		join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-generated-mapping-"),
	);
	try {
		await cp(collaborationRoot, temporary, { recursive: true });
		const path = join(temporary, "src/message-operations.ts");
		const source = await readFile(path, "utf8");
		await writeFile(
			path,
			source.replace(
				/\n\t\t\tissueMappings: \{\n\t\t\t\tmessageEvents: \{ invalidKind: "invalidMessageEvent" \},\n\t\t\t\},/,
				"",
			),
		);
		await expect(
			compileApplication({ applicationRoot: temporary }),
		).rejects.toMatchObject({
			code: "QP-COMPOSE-027",
			diagnosticClass: "missingIssueMapping",
			details: {
				operation: "mutation:messageEvents.create",
				path: [
					"mutation:messageEvents.create",
					"collection:messageEvents/create",
				],
				issue: "issue:messageEvents/invalidKind",
			},
		});
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);

test("reports unsupported lifecycle capture at its authored Origin", async () => {
	const temporary = await mkdtemp(
		join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-origin-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const path = join(temporary, "src/tickets.ts");
		const source = await readFile(path, "utf8");
		await writeFile(
			path,
			source.replace(
				/\t\tnormalize: \(\{ input \}\) =>[\s\S]*?\n\t\t\t\t: input,/,
				"\t\tnormalize: ({ input }) => crypto.randomUUID(),",
			),
		);

		try {
			await compileApplication({ applicationRoot: temporary });
			throw new Error("expected lifecycle capture diagnostic");
		} catch (error) {
			expect(error).toBeInstanceOf(CompilerDiagnosticError);
			expect(error).toMatchObject({
				code: "QP-COMPOSE-026",
				diagnosticClass: "lifecycleCapture",
				details: {
					origin: { module: "src/tickets.ts", line: 83, column: 29 },
					phase: "normalize",
				},
			});
		}
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);

test("rejects an incomplete issue mapping with the complete Collection-call path", async () => {
	const temporary = await mkdtemp(
		join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-reachability-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const collectionPath = join(temporary, "src/tickets.ts");
		const collectionSource = await readFile(collectionPath, "utf8");
		await writeFile(
			collectionPath,
			collectionSource
				.replace(
					"\t\tinvalidReference: collection.issue(),",
					"\t\tinvalidReference: collection.issue(),\n\t\temptySummary: collection.issue(),",
				)
				.replace(
					"\t\t\t\tthrow issues.invalidReference();",
					'\t\t\t\tthrow issues.invalidReference();\n\t\t\tif (candidate.summary === "") throw issues.emptySummary();',
				),
		);
		const mutationPath = join(temporary, "src/ticket-mutations.ts");
		const mutationSource = await readFile(mutationPath, "utf8");
		let mappingIndex = 0;
		await writeFile(
			mutationPath,
			mutationSource.replace(
				/tickets: \{ invalidReference: "invalidTicket" \},/g,
				(match) =>
					mappingIndex++ === 0
						? match
						: 'tickets: { invalidReference: "invalidTicket", emptySummary: "invalidTicket" },',
			),
		);

		try {
			await compileApplication({ applicationRoot: temporary });
			throw new Error("expected missing issue mapping diagnostic");
		} catch (error) {
			expect(error).toBeInstanceOf(CompilerDiagnosticError);
			expect(error).toMatchObject({
				code: "QP-COMPOSE-027",
				diagnosticClass: "missingIssueMapping",
				details: {
					phase: "validate",
					origin: { module: "src/tickets.ts", line: 94, column: 34 },
					mappingOrigin: {
						module: "src/ticket-mutations.ts",
						line: 85,
						column: 2,
					},
					callOrigin: {
						module: "src/ticket-mutations.ts",
						line: 86,
						column: 3,
					},
					operation: "mutation:ticket.create",
					path: ["mutation:ticket.create", "collection:tickets/create"],
					issue: "issue:tickets/emptySummary",
				},
			});
			expect((error as CompilerDiagnosticError).details.rewrite).toContain(
				'emptySummary: "declaredError"',
			);
		}
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);

test("uses issue mappings, not handler syntax, as Collection capability admission", async () => {
	const temporary = await mkdtemp(
		join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-admission-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const mutationPath = join(temporary, "src/ticket-mutations.ts");
		const source = await readFile(mutationPath, "utf8");
		await writeFile(
			mutationPath,
			source.replace(
				"\t\tconst ticket = await ctx.data.tickets.create({",
				"\t\tconst ticketData = ctx.data.tickets;\n\t\tconst ticket = await ticketData.create({",
			),
		);

		const compilation = await compileApplication({
			applicationRoot: temporary,
		});
		expect(compilation.generatedFiles["app.ts"]).toContain(
			'readonly "invalidReference": "invalidTicket";',
		);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);

test("rejects a non-identity Collection issue at its exact declaration", async () => {
	const temporary = await mkdtemp(
		join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-issue-name-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const path = join(temporary, "src/tickets.ts");
		const source = await readFile(path, "utf8");
		await writeFile(
			path,
			source.replace(
				"\t\tinvalidReference: collection.issue(),",
				'\t\t"bad/name": collection.issue(),',
			),
		);

		await expect(
			compileApplication({ applicationRoot: temporary }),
		).rejects.toMatchObject({
			code: "QP-COMPOSE-027",
			diagnosticClass: "invalidIssueDeclaration",
			details: {
				phase: "validate",
				origin: { module: "src/tickets.ts", line: 80, column: 3 },
				rewrite: "use an identifier-safe issue name and collection.issue()",
			},
		});
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);

test("rejects unknown, borrowed, and payload-bearing issue mappings", async () => {
	for (const [label, originLine, rewrite] of [
		[
			"unknown issue",
			86,
			(source: string) =>
				source.replace(
					'tickets: { invalidReference: "invalidTicket" },',
					'tickets: { unknownIssue: "invalidTicket" },',
				),
		],
		[
			"borrowed error",
			86,
			(source: string) =>
				source.replace(
					'tickets: { invalidReference: "invalidTicket" },',
					'tickets: { invalidReference: "notDeclaredHere" },',
				),
		],
		[
			"payload-bearing error",
			92,
			(source: string) =>
				source
					.replace(
						"const transitionRejected = operation.error({",
						`const invalidWithPayload = operation.error({
	code: "INVALID_WITH_PAYLOAD",
	status: 422,
	payload: codec.object({ detail: codec.text() }),
});

const transitionRejected = operation.error({`,
					)
					.replace(
						"errors: { invalidTicket, ticketUnavailable },",
						"errors: { invalidTicket, invalidWithPayload, ticketUnavailable },",
					)
					.replace(
						'invalidReference: "invalidTicket"',
						'invalidReference: "invalidWithPayload"',
					),
		],
	] as const) {
		const temporary = await mkdtemp(
			join(resolve(import.meta.dir, "../.."), `.tmp-adr0031-${label}-`),
		);
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			const path = join(temporary, "src/ticket-mutations.ts");
			await writeFile(path, rewrite(await readFile(path, "utf8")));
			await expect(
				compileApplication({ applicationRoot: temporary }),
			).rejects.toMatchObject({
				code: "QP-COMPOSE-027",
				diagnosticClass: "invalidIssueMapping",
				details: {
					origin: {
						module: "src/ticket-mutations.ts",
						line: originLine,
						column: 14,
					},
				},
			});
		} finally {
			await rm(temporary, { force: true, recursive: true });
		}
	}
}, 30_000);

test("reports a helper-authored issue mapping at its exact key Origin", async () => {
	const temporary = await mkdtemp(
		join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-helper-origin-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const path = join(temporary, "src/ticket-mutations.ts");
		const source = (await readFile(path, "utf8"))
			.replace(
				"export const createTicket = defineMutation({",
				`const createIssueMappings = {
	tickets: { unknownIssue: "invalidTicket" },
};

export const createTicket = defineMutation({`,
			)
			.replace(
				`issueMappings: {
		tickets: { invalidReference: "invalidTicket" },
	},`,
				"issueMappings: createIssueMappings,",
			);
		await writeFile(path, source);
		const prefix = source.slice(0, source.indexOf("unknownIssue"));
		const lines = prefix.split("\n");
		await expect(
			compileApplication({ applicationRoot: temporary }),
		).rejects.toMatchObject({
			code: "QP-COMPOSE-027",
			diagnosticClass: "invalidIssueMapping",
			details: {
				origin: {
					module: "src/ticket-mutations.ts",
					line: lines.length,
					column: lines.at(-1)!.length + 1,
				},
			},
		});
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);

test("rejects unsupported lifecycle syntax and capability at compilation", async () => {
	for (const [authored, diagnosticClass] of [
		[
			"\t\tnormalize: async ({ input }) => input,",
			"unsupportedLifecycleSyntax",
		],
		[
			"\t\tnormalize: ({ input }) => { throw input; },",
			"unsupportedLifecycleCapability",
		],
	] as const) {
		const temporary = await mkdtemp(
			join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-hostile-"),
		);
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			const path = join(temporary, "src/tickets.ts");
			const source = await readFile(path, "utf8");
			await writeFile(
				path,
				source.replace(
					/\t\tnormalize: \(\{ input \}\) =>[\s\S]*?\n\t\t\t\t: input,/,
					authored,
				),
			);
			await expect(
				compileApplication({ applicationRoot: temporary }),
			).rejects.toMatchObject({ code: "QP-COMPOSE-026", diagnosticClass });
		} finally {
			await rm(temporary, { force: true, recursive: true });
		}
	}
}, 30_000);
