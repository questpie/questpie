import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
	compileApplication,
	CompilerDiagnosticError,
} from "@questpie/compiler";

const fixtureRoot = resolve(
	import.meta.dir,
	"../../fixtures/team-support-desk",
);

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
