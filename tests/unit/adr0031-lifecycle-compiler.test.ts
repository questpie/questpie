import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(
	import.meta.dir,
	"../../fixtures/team-support-desk",
);

test("compiles Team Support Desk lifecycle authoring without retaining callbacks", async () => {
	const temporary = await mkdtemp(
		join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-compiler-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const baseline = await compileApplication({ applicationRoot: temporary });

		const ticketsPath = join(temporary, "src/tickets.ts");
		const ticketsSource = await readFile(ticketsPath, "utf8");
		await writeFile(
			ticketsPath,
			ticketsSource
				.replace(
					'import { constraint, defineCollection, field, index, relation } from "questpie";',
					'import { collection, constraint, defineCollection, field, index, relation } from "questpie";',
				)
				.replace(
					"\tconstraints: {",
					`\tissues: {
\t\tinvalidReference: collection.issue(),
\t},
\tlifecycle: {
\t\tnormalize: ({ input }) =>
\t\t\tinput.reference?.includes("")
\t\t\t\t? { ...input, reference: input.reference.trim() }
\t\t\t\t: input,
\t\tvalidate: ({ candidate, issues }) => {
\t\t\t/* AUTHORED_LIFECYCLE_CALLBACK_MUST_NOT_SHIP */
\t\t\tif (!candidate.reference.startsWith("SUP-") && !candidate.reference.startsWith("WEB-"))
\t\t\t\tthrow issues.invalidReference();
\t\t},
\t},
\tconstraints: {`,
				),
		);

		const mutationsPath = join(temporary, "src/ticket-mutations.ts");
		const mutationsSource = await readFile(mutationsPath, "utf8");
		await writeFile(
			mutationsPath,
			mutationsSource
				.replace(
					"const ticketUnavailable = operation.error({",
					`const invalidTicket = operation.error({
\tcode: "INVALID_TICKET",
\tstatus: 422,
});

const ticketUnavailable = operation.error({`,
				)
				.replace(
					"\terrors: { ticketUnavailable },\n\thandler: async ({ input, ctx }) => {",
					`\terrors: { invalidTicket, ticketUnavailable },
\tissueMappings: {
\t\ttickets: { invalidReference: "invalidTicket" },
\t},
\thandler: async ({ input, ctx }) => {`,
				),
		);

		const compilation = await compileApplication({
			applicationRoot: temporary,
		});
		expect(compilation.generatedFiles["schema-projection.json"]).toBe(
			baseline.generatedFiles["schema-projection.json"],
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

		const app = compilation.generatedFiles["app.ts"]!;
		expect(app).toContain('readonly "invalidReference": "invalidTicket";');
		expect(app).toContain(
			'issueMappings?: GeneratedMutations[Name]["issueMappings"]',
		);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);
