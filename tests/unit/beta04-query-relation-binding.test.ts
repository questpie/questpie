import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

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
