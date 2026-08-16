import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

import {
	normalizeReactionContract,
	projectReactionContracts,
} from "../../packages/compiler/src/reaction";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

test("derives the typed pending-intent target from one authored Reaction", async () => {
	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	const manifest = JSON.parse(compilation.generatedFiles["manifest.json"]!);
	const originMap = JSON.parse(compilation.generatedFiles["origin-map.json"]!);

	expect(
		manifest.composition.resources.some(
			(resource: { identity: string }) =>
				resource.identity === "reaction:messagePublished",
		),
	).toBe(true);
	expect(
		originMap.resources.find(
			(resource: { identity: string }) =>
				resource.identity === "reaction:messagePublished",
		)?.establishedAt,
	).toMatchObject({
		kind: "export",
		packageId: null,
		path: "src/message-published.ts",
		exportName: "messagePublished",
	});
	expect(compilation.generatedFiles["app.ts"]).toContain(
		'"messagePublished"(input: Readonly<{ readonly "companyId": string; readonly "messageId": string; }>): Promise<void>;',
	);
	expect(compilation.generatedFiles["app.ts"]).not.toContain(
		"messagePublished(input: Readonly<{ companyId: string; messageId: string }>",
	);
	const executables = JSON.parse(
		compilation.generatedFiles["runtime-executables.json"]!,
	);
	expect(
		executables.slots.some(
			(slot: { identity: string }) =>
				slot.identity === "reaction:messagePublished",
		),
	).toBe(false);

	const projection = projectReactionContracts([
		{
			identity: "reaction:messagePublished",
			kind: "reaction",
			name: "messagePublished",
			contract: {
				format: "questpie.reaction-definition-contract",
				version: 1,
				name: "messagePublished",
				input: {
					kind: "object",
					properties: {
						companyId: { kind: "uuid" },
						messageId: { kind: "uuid" },
					},
				},
				executableSlots: [],
			},
			contributions: [],
			origin: {
				logicalPath: "src/message-published.ts",
				exportName: "messagePublished",
				packageId: null,
				span: null,
				memberSpans: {},
			},
			value: {},
		},
	]);
	expect(projection).toEqual({
		format: "questpie.reaction-projection",
		version: 1,
		reactions: [
			{
				identity: "reaction:messagePublished",
				input: {
					kind: "object",
					properties: {
						companyId: { kind: "uuid" },
						messageId: { kind: "uuid" },
					},
				},
				origin: {
					path: "src/message-published.ts",
					exportName: "messagePublished",
					packageId: null,
				},
			},
		],
	});
});

test("rejects executable Reaction behavior before the BETA-08 owner", () => {
	expect(() =>
		normalizeReactionContract(
			{
				name: "messagePublished",
				input: { kind: "uuid" },
				handler: () => undefined,
			},
			(value) => value,
		),
	).toThrow("reaction.handler is outside the BETA-06 static dispatch contract");
});
