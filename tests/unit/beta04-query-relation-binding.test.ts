import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

import { createOperationEngine } from "../../packages/runtime/src/operation";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const deskFixtureRoot = resolve(
	import.meta.dir,
	"../../fixtures/team-support-desk",
);

test("binds one-hop Relation selection to its target disclosure Policy", async () => {
	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	const queryProjection = JSON.parse(
		compilation.generatedFiles["query-projection.json"] ?? "null",
	) as {
		queries: readonly {
			policy: string;
			template: { from: string; select: readonly unknown[] };
		}[];
	};
	const policyProjection = JSON.parse(
		compilation.generatedFiles["policy-projection.json"] ?? "null",
	) as {
		policies: readonly {
			program: { identity: string; target: string };
		}[];
	};
	const messagePage = queryProjection.queries.find(
		({ template }) => template.from === "collection:messages",
	);
	if (!messagePage) throw new Error("expected the Message page projection");
	const membershipPolicy = policyProjection.policies.find(
		({ program }) => program.identity === "policy:memberships.default",
	);
	if (!membershipPolicy)
		throw new Error("expected the Membership disclosure Policy");
	const messagePolicy = policyProjection.policies.find(
		({ program }) => program.identity === "policy:messages.default",
	);
	if (!messagePolicy) throw new Error("expected the Message disclosure Policy");

	expect(queryProjection.queries).toHaveLength(1);
	expect(messagePage).toMatchObject({
		policy: "policy:messages.default",
	});
	expect(messagePage.template.select[0]).toEqual({
		kind: "toOne",
		key: "author",
		relation: "collection:messages/relation:author",
		select: [
			{
				kind: "field",
				key: "id",
				field: "collection:memberships/field:id",
			},
			{
				kind: "field",
				key: "role",
				field: "collection:memberships/field:role",
			},
		],
	});
	expect(membershipPolicy.program.target).toBe("collection:memberships");
	expect(messagePolicy.program.target).toBe("collection:messages");
});

test("marks a conditionally disclosed nested Field optional in the Operation codec", async () => {
	const temporary = await mkdtemp(
		join(tmpdir(), "questpie-nested-disclosure-"),
	);
	try {
		await cp(deskFixtureRoot, temporary, { recursive: true });
		const policyPath = join(temporary, "src/memberships/policy.ts");
		const source = await readFile(policyPath, "utf8");
		const needle = "\tfields: {\n\t\tupdate:";
		expect(source).toContain(needle);
		await writeFile(
			policyPath,
			source.replace(
				needle,
				`\tfields: {
\t\toutput: ({ row }) => ({ role: row.id.equal(row.id) }),
\t\tupdate:`,
			),
		);
		for (const relativePath of ["src/tickets/queries.ts"]) {
			const path = join(temporary, relativePath);
			const querySource = await readFile(path, "utf8");
			await writeFile(
				path,
				querySource.replaceAll(
					"role: codec.text()",
					"role: codec.optional(codec.text())",
				),
			);
		}
		const compilation = await compileApplication({
			applicationRoot: temporary,
		});
		const contracts = JSON.parse(
			compilation.generatedFiles["operation-contracts.json"] ?? "null",
		) as {
			operations: readonly Readonly<Record<string, unknown>>[];
		};
		const contract = contracts.operations.find(
			(candidate) => candidate.identity === "query:tickets.queue",
		) as {
			output: {
				properties: {
					nodes: {
						items: {
							properties: {
								assignee: {
									codec: { properties: { role: unknown } };
								};
							};
						};
					};
				};
			};
		};

		expect(
			contract.output.properties.nodes.items.properties.assignee.codec
				.properties.role,
		).toEqual({ kind: "optional", codec: { kind: "text" } });
		const result = {
			nodes: [
				{
					id: crypto.randomUUID(),
					organizationId: crypto.randomUUID(),
					teamId: crypto.randomUUID(),
					requesterMembershipId: crypto.randomUUID(),
					assigneeMembershipId: null,
					reference: "T-1",
					summary: "Example",
					status: "open",
					priority: "normal",
					updatedAt: new Date("2026-08-27T12:00:00.000Z"),
					team: null,
					assignee: {
						id: crypto.randomUUID(),
						principalId: crypto.randomUUID(),
					},
				},
			],
			pageInfo: { endCursor: null, hasNextPage: false },
		};
		const execute = () => result;
		const engine = createOperationEngine(
			[
				{
					identity: "query:tickets.queue",
					kind: "query",
					slot: "handler",
					runtimeGraphDigest: "a".repeat(64),
					bundleExport: "ticketsQueue",
					execute,
					definition: { name: "tickets.queue", handler: execute },
				},
			],
			[
				{
					identity: "query:tickets.queue",
					input: { kind: "object", properties: {} },
					output: contract.output as never,
					declaredErrors: [],
				},
			],
		);
		const prepared = engine.prepare("query:tickets.queue", {});
		expect(await engine.invokePrepared(prepared, undefined)).toEqual(result);
		expect(engine.decodeResult(prepared, result)).toEqual(result);
		const disclosed = {
			...result,
			nodes: [
				{
					...result.nodes[0],
					assignee: { ...result.nodes[0]!.assignee, role: "agent" },
				},
			],
		};
		expect(engine.decodeResult(prepared, disclosed)).toEqual(disclosed);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
});
