import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(
	import.meta.dir,
	"../../fixtures/team-support-desk",
);

test("carries the accepted inverse fixture through Template and Query Projection v2", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-inv02-artifacts-"));
	await cp(fixtureRoot, temporary, { recursive: true });
	const accepted = await readFile(
		join(temporary, "src/tickets/__fixtures__/inverse-projection.ts"),
		"utf8",
	);
	await writeFile(
		join(temporary, "src/inverse-projection.ts"),
		accepted.replaceAll('from "../../', 'from "./'),
	);
	const compilation = await compileApplication({ applicationRoot: temporary });
	const projection = JSON.parse(
		compilation.generatedFiles["query-projection.json"] ?? "null",
	) as {
		version: number;
		queries: readonly {
			templateVersion: number;
			template: Readonly<Record<string, unknown>>;
		}[];
	};
	const inverse = projection.queries.find(({ template }) =>
		Array.isArray(template.select)
			? template.select.some(
					(selection) =>
						(selection as Readonly<Record<string, unknown>>).kind ===
						"inverseList",
				)
			: false,
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
	await rm(temporary, { recursive: true, force: true });
});
