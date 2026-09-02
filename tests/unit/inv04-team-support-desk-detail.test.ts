import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(
	import.meta.dir,
	"../../fixtures/team-support-desk",
);

test("publishes comments only through the nullable tickets.detail contract", async () => {
	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	const contracts = JSON.parse(
		compilation.generatedFiles["operation-contracts.json"] ?? "null",
	) as {
		operations: readonly Readonly<{
			identity: string;
			output: unknown;
		}>[];
	};
	const identities = contracts.operations.map(({ identity }) => identity);
	const detail = contracts.operations.find(
		({ identity }) => identity === "query:tickets.detail",
	);
	if (!detail) expect.unreachable();

	expect(identities).not.toContain("query:comments.page");
	expect(JSON.stringify(detail.output)).toContain('"comments"');

	const projection = JSON.parse(
		compilation.generatedFiles["query-projection.json"] ?? "null",
	) as {
		queries: readonly Readonly<{
			template: Readonly<{
				from: string;
				select: readonly Readonly<{ kind: string; key: string }>[];
			}>;
			templateVersion: number;
		}>[];
	};
	const detailPlan = projection.queries.find(
		({ template }) =>
			template.from === "collection:tickets" &&
			template.select.some(
				({ kind, key }) => kind === "inverseList" && key === "comments",
			),
	);

	expect(detailPlan?.templateVersion).toBe(2);
});
