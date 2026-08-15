import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { projectRelationalGeneratedContract } from "../../packages/compiler/src/relational";

const questpieSource = resolve(import.meta.dir, "../../packages/questpie/src");

test("keeps the questpie public root barrel outward-only", async () => {
	const offenders: string[] = [];
	for await (const relativePath of new Bun.Glob("**/*.ts").scan({
		cwd: questpieSource,
	})) {
		if (relativePath === "index.ts") continue;
		const source = await Bun.file(resolve(questpieSource, relativePath)).text();
		if (/from\s+["'](?:\.\.\/|\.\/)index["']/.test(source))
			offenders.push(relativePath);
	}
	expect(offenders.sort()).toEqual([]);
});

test("projects the exact generated Query declaration contract behind the relational seam", () => {
	const contract = projectRelationalGeneratedContract({
		policies: [
			{
				format: "questpie.policy-program",
				version: 1,
				identity: "policy:messages.default",
				target: "collection:messages",
				attachment: { kind: "default", requiredForNormalDataAccess: true },
				operations: {},
				fields: {
					callerInput: { suppliedPathsOnly: true },
					selectedOutput: [
						{ path: ["body"], when: { kind: "constant", value: true } },
					],
				},
			},
		],
		queries: [
			{
				policy: "policy:messages.default",
				origin: { path: "src/message-page.ts", exportName: "messagePage" },
				select: [
					{
						kind: "field",
						key: "body",
						field: "collection:messages/field:body",
					},
					{
						kind: "toOne",
						key: "author",
						relation: "collection:messages/relation:author",
						select: [
							{
								kind: "field",
								key: "id",
								field: "collection:memberships/field:id",
							},
						],
					},
				],
			},
		],
	});

	expect(contract).toEqual({
		queries: [
			{
				origin: { path: "src/message-page.ts", exportName: "messagePage" },
				select: [
					{
						kind: "field",
						key: "body",
						field: "collection:messages/field:body",
						optional: true,
					},
					{
						kind: "toOne",
						key: "author",
						select: [
							{
								kind: "field",
								key: "id",
								field: "collection:memberships/field:id",
								optional: false,
							},
						],
					},
				],
			},
		],
	});
});
