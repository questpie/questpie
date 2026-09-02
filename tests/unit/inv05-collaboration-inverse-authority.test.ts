import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

test("publishes one Policy-aware channel detail inverse message list", async () => {
	const compilation = await compileApplication({ applicationRoot: fixtureRoot });
	const contracts = JSON.parse(
		compilation.generatedFiles["operation-contracts.json"] ?? "null",
	) as {
		operations: readonly Readonly<{
			identity: string;
			output: unknown;
		}>[];
	};
	const detail = contracts.operations.find(
		({ identity }) => identity === "query:channels.detail",
	);
	if (!detail) expect.unreachable();

	expect(JSON.stringify(detail.output)).toContain('"messages"');
	expect(JSON.stringify(detail.output)).toContain('"optional"');

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
			template.from === "collection:channels" &&
			template.select.some(
				({ kind, key }) => kind === "inverseList" && key === "messages",
			),
	);

	expect(detailPlan?.templateVersion).toBe(2);
});
