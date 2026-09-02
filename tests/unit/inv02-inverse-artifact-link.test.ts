import { expect, test } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

import {
	canonicalBytes,
	contentDigest,
} from "../../packages/compiler/src/canonical";
import { dataQueryTemplateDigest } from "../../packages/compiler/src/relational";

const fixtureRoot = resolve(
	import.meta.dir,
	"../../fixtures/team-support-desk",
);
const toOneFixtureRoot = resolve(
	import.meta.dir,
	"../../fixtures/archive",
);

test("carries the accepted inverse fixture through Template and Query Projection v2", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-inv02-artifacts-"));
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const compilation = await compileApplication({
			applicationRoot: temporary,
		});
		const projection = JSON.parse(
			compilation.generatedFiles["query-projection.json"] ?? "null",
		) as {
			version: number;
			queries: readonly {
				digest: string;
				policy: string;
				templateVersion: 1 | 2;
				template: Readonly<Record<string, unknown>> & {
					select: readonly Readonly<Record<string, unknown>>[];
				};
			}[];
		};
		const inverse = projection.queries.find(({ template }) =>
			template.select.some(({ kind }) => kind === "inverseList"),
		);
		if (!inverse) expect.unreachable();
		const inverseSelection = inverse.template.select.find(
			({ kind }) => kind === "inverseList",
		);

		expect(projection.version).toBe(2);
		expect(inverse).toMatchObject({
			templateVersion: 2,
			template: {
				format: "questpie.data-query-template",
				version: 2,
				maximumRelationEdges: 4,
			},
		});
		expect(inverseSelection).toEqual({
			kind: "inverseList",
			key: "comments",
			relation: "collection:comments/relation:ticket",
			source: "collection:comments",
			first: 50,
			filter: null,
			order: [
				{
					field: "collection:comments/field:createdAt",
					direction: "desc",
					nulls: "last",
				},
				{
					field: "collection:comments/field:id",
					direction: "desc",
					nulls: "last",
				},
			],
			select: [
				{
					kind: "field",
					key: "authorMembershipId",
					field: "collection:comments/field:authorMembershipId",
				},
				{
					kind: "field",
					key: "body",
					field: "collection:comments/field:body",
				},
				{
					kind: "field",
					key: "createdAt",
					field: "collection:comments/field:createdAt",
				},
				{
					kind: "field",
					key: "id",
					field: "collection:comments/field:id",
				},
				{
					kind: "field",
					key: "kind",
					field: "collection:comments/field:kind",
				},
				{
					kind: "field",
					key: "ticketId",
					field: "collection:comments/field:ticketId",
				},
			],
		});
		expect(inverse.digest).toBe(
			dataQueryTemplateDigest(inverse.template as never),
		);

		const plansBytes = compilation.generatedFiles["postgres-query-plans.json"]!;
		const plans = JSON.parse(plansBytes) as {
			version: number;
			plans: readonly Readonly<Record<string, unknown>>[];
		};
		const plan = plans.plans.find(
			(candidate) => candidate.queryDigest === inverse.digest,
		) as Readonly<Record<string, unknown>> & {
			result: readonly Readonly<Record<string, unknown>>[];
		};
		expect(plans.version).toBe(2);
		expect(plan).toMatchObject({
			version: 2,
			templateVersion: 2,
			queryDigest: inverse.digest,
			templateDigest: inverse.digest,
			ordinalColumns: [
				"qp_root_ordinal",
				expect.stringMatching(/^qp_inverse_/),
			],
			statementDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
			policyProgramDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
			inversePolicyProgramDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
		});
		expect(
			plan.result.find(({ kind }) => kind === "inverseList"),
		).toMatchObject({
			key: "comments",
			relation: "collection:comments/relation:ticket",
			source: "collection:comments",
			first: 50,
			correlation: [
				{
					field: "collection:comments/field:ticketId",
					reference: "collection:tickets/field:id",
				},
			],
		});

		const expected = projection.queries
			.map(({ digest, templateVersion }) => ({ digest, templateVersion }))
			.toSorted((left, right) =>
				left.digest < right.digest ? -1 : left.digest > right.digest ? 1 : 0,
			);
		const { linkPostgresQueryPlans } =
			await import("../../packages/runtime/src/relational/postgres-database");
		expect(() => linkPostgresQueryPlans(plansBytes, expected)).not.toThrow();
		const rejectedPlan = (
			mutate: (
				envelope: Record<string, unknown> & {
					plans: Record<string, unknown>[];
				},
			) => void,
		) => {
			const forged = JSON.parse(JSON.stringify(plans)) as Record<
				string,
				unknown
			> & {
				plans: Record<string, unknown>[];
			};
			mutate(forged);
			expect(() =>
				linkPostgresQueryPlans(canonicalBytes(forged), expected),
			).toThrow();
		};
		rejectedPlan((envelope) => (envelope.version = 3));
		rejectedPlan((envelope) => (envelope.version = 1));
		expect(() =>
			linkPostgresQueryPlans(
				plansBytes,
				expected.map((entry) =>
					entry.digest === inverse.digest
						? { ...entry, templateVersion: 1 }
						: entry,
				),
			),
		).toThrow();
		const inversePlan = (
			envelope: Record<string, unknown> & {
				plans: Record<string, unknown>[];
			},
		) =>
			envelope.plans.find(
				(candidate) => candidate.queryDigest === inverse.digest,
			)!;
		for (const mutate of [
			(value: Record<string, unknown>) =>
				(value.templateDigest = "0".repeat(64)),
			(value: Record<string, unknown>) =>
				((value.result as Record<string, unknown>[]).find(
					(candidate) => candidate.kind === "inverseList",
				)!.relation = "collection:comments/relation:other"),
			(value: Record<string, unknown>) =>
				((value.result as Record<string, unknown>[]).find(
					(candidate) => candidate.kind === "inverseList",
				)!.source = "collection:auditEntries"),
			(value: Record<string, unknown>) =>
				((value.ordinalColumns as string[])[1] = "qp_inverse_99_ordinal"),
			(value: Record<string, unknown>) =>
				((
					(value.result as Record<string, unknown>[]).find(
						(candidate) => candidate.kind === "inverseList",
					)!.fields as Record<string, unknown>[]
				)[0]!.column = "qp_secret"),
			(value: Record<string, unknown>) =>
				(value.policyProgramDigest = "1".repeat(64)),
			(value: Record<string, unknown>) =>
				(value.inversePolicyProgramDigest = "2".repeat(64)),
			(value: Record<string, unknown>) => (value.sql = "SELECT 1;\n"),
		] as const)
			rejectedPlan((envelope) => mutate(inversePlan(envelope)));

		const appContract = compilation.generatedFiles["app.ts"]!;
		expect(appContract).toContain('"comments": readonly {');
		expect(appContract).not.toMatch(/"comments": readonly \{[^}]*pageInfo/s);
		const runtimeBuild = JSON.parse(
			compilation.generatedFiles["runtime-build.json"]!,
		) as {
			appContractDigest: string;
			queryProjectionDigest: string;
			postgresQueryPlansDigest: string;
			inventory: readonly { path: string; digest: string }[];
		};
		expect(runtimeBuild).toMatchObject({
			appContractDigest: contentDigest(appContract),
			queryProjectionDigest: contentDigest(
				compilation.generatedFiles["query-projection.json"]!,
			),
			postgresQueryPlansDigest: contentDigest(plansBytes),
		});
		for (const path of [
			"app.ts",
			"query-projection.json",
			"postgres-query-plans.json",
		])
			expect(runtimeBuild.inventory).toContainEqual({
				path,
				digest: contentDigest(compilation.generatedFiles[path]!),
			});
		const { decodeRuntimeArtifacts } =
			await import("../../packages/runtime/src/application/artifacts");
		const { verifyRuntimeArtifactFiles } =
			await import("../../packages/runtime/src/application/artifact-files");
		const runtimeExecutables = JSON.parse(
			compilation.generatedFiles["runtime-executables.json"]!,
		);
		const operationContracts = JSON.parse(
			compilation.generatedFiles["operation-contracts.json"]!,
		);
		const httpContract = JSON.parse(
			compilation.generatedFiles["operation-http-contract.json"]!,
		);
		const runtimeArtifacts = decodeRuntimeArtifacts({
			runtimeBuild,
			runtimeExecutables,
			operationContracts,
			httpContract,
		});
		const artifactFiles = Object.fromEntries(
			runtimeBuild.inventory.map(({ path }) => [
				path,
				compilation.generatedFiles[path]!,
			]),
		);
		expect(() =>
			verifyRuntimeArtifactFiles(runtimeArtifacts, artifactFiles),
		).not.toThrow();
		for (const path of [
			"app.ts",
			"query-projection.json",
			"postgres-query-plans.json",
		])
			expect(() =>
				verifyRuntimeArtifactFiles(runtimeArtifacts, {
					...artifactFiles,
					[path]: `${artifactFiles[path]} `,
				}),
			).toThrow();
		expect(() =>
			decodeRuntimeArtifacts({
				runtimeBuild: {
					...runtimeBuild,
					queryProjectionDigest: "0".repeat(64),
				},
				runtimeExecutables,
				operationContracts,
				httpContract,
			}),
		).toThrow();

		const originalBytes = canonicalBytes(inverse.template);
		const originalDigest = inverse.digest;
		const inverseNode = (value: Record<string, unknown>) =>
			(value.select as Record<string, unknown>[]).find(
				(candidate) => candidate.kind === "inverseList",
			)!;
		for (const mutate of [
			(value: Record<string, unknown>) => (value.maximumRelationEdges = 3),
			(value: Record<string, unknown>) => (inverseNode(value).key = "replies"),
			(value: Record<string, unknown>) =>
				(inverseNode(value).relation = "collection:comments/relation:other"),
			(value: Record<string, unknown>) =>
				(inverseNode(value).source = "collection:auditEntries"),
			(value: Record<string, unknown>) => (inverseNode(value).first = 49),
			(value: Record<string, unknown>) =>
				(inverseNode(value).filter = {
					kind: "constant",
					value: true,
				}),
			(value: Record<string, unknown>) =>
				((inverseNode(value).order as Record<string, unknown>[])[0]!.direction =
					"asc"),
			(value: Record<string, unknown>) =>
				((inverseNode(value).select as Record<string, unknown>[])[1]!.field =
					"collection:comments/field:kind"),
		] as const) {
			const changed = JSON.parse(JSON.stringify(inverse.template)) as Record<
				string,
				unknown
			>;
			mutate(changed);
			expect(canonicalBytes(changed)).not.toBe(originalBytes);
			expect(dataQueryTemplateDigest(changed as never)).not.toBe(
				originalDigest,
			);
		}
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}, 20_000);

test("keeps all-toOne applications on byte-identical v1 artifacts", async () => {
	const compilation = await compileApplication({
		applicationRoot: toOneFixtureRoot,
	});
	const queryBytes = compilation.generatedFiles["query-projection.json"]!;
	const plansBytes = compilation.generatedFiles["postgres-query-plans.json"]!;
	expect(JSON.parse(queryBytes).version).toBe(1);
	expect(JSON.parse(plansBytes).version).toBe(1);
	expect(contentDigest(queryBytes)).toBe(
		"6c3a7f8283cb9be965fd932c81055dfa2bfdb5263ec5c18ef0845dc200a505c2",
	);
	expect(contentDigest(plansBytes)).toBe(
		"a4fa08d787a0eb65ca3c632549b5c648438a93fead7a90eb124eeb1a2a9a6bc5",
	);
}, 20_000);

test("renders conditional child Fields optional inside one non-null readonly array", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-inv02-types-"));
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const compilation = await compileApplication({
			applicationRoot: temporary,
		});
		const appContract = compilation.generatedFiles["app.ts"]!;
		expect(appContract).toContain(
			'"comments": readonly { "authorMembershipId": string; "body"?: string; "createdAt": string; "id": string; "kind": string; "ticketId": string; }[];',
		);
		expect(appContract).not.toContain(
			'"comments": readonly { "authorMembershipId": string; "body"?: string; "createdAt": string; "id": string; "kind": string; "ticketId": string; }[] | null;',
		);
		expect(appContract).not.toContain('"comments": Readonly<{ nodes:');
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}, 20_000);
