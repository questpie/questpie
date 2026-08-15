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
			template: { select: readonly unknown[] };
		}[];
	};
	const policyProjection = JSON.parse(
		compilation.generatedFiles["policy-projection.json"] ?? "null",
	) as { policies: readonly { program: { identity: string } }[] };

	expect(queryProjection.queries).toHaveLength(1);
	expect(queryProjection.queries[0]).toMatchObject({
		policy: "policy:messages.default",
	});
	expect(queryProjection.queries[0]?.template.select[0]).toEqual({
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
	expect(
		policyProjection.policies.map(({ program }) => program.identity),
	).toEqual(["policy:memberships.default", "policy:messages.default"]);
});
