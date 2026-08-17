import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

import {
	normalizeReactionContract,
	projectReactionContracts,
} from "../../packages/compiler/src/reaction";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

const acceptedContract = {
	name: "messagePublished",
	input: { kind: "object", properties: { messageId: { kind: "uuid" } } },
	output: { kind: "object", properties: { messageId: { kind: "uuid" } } },
	runAs: { kind: "durableRunAs", actor: "caller", whenDenied: "fail" },
	retry: {
		kind: "durableRetry",
		maximumAttempts: 8,
		initialDelayMilliseconds: 1_000,
		backoff: "exponential",
		maximumDelayMilliseconds: 900_000,
		jitter: "full",
		horizonMilliseconds: 86_400_000,
	},
	effects: ["deliver-message"],
} as const;

test("derives the typed dispatch target and the executed handler from one authored Reaction", async () => {
	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	const manifest = JSON.parse(compilation.generatedFiles["manifest.json"]!);
	const originMap = JSON.parse(compilation.generatedFiles["origin-map.json"]!);
	const runtimeBuild = JSON.parse(
		compilation.generatedFiles["runtime-build.json"]!,
	);
	const projected = JSON.parse(
		compilation.generatedFiles["reaction-projection.json"]!,
	);

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
		'"messagePublished"(input: Readonly<{ readonly "channelId": string; readonly "companyId": string; readonly "messageId": string; }>): Promise<void>;',
	);
	const executables = JSON.parse(
		compilation.generatedFiles["runtime-executables.json"]!,
	);
	expect(
		executables.slots.filter(
			(slot: { identity: string }) =>
				slot.identity === "reaction:messagePublished",
		),
	).toMatchObject([{ kind: "reaction", slot: "handler" }]);
	expect(projected).toMatchObject({
		format: "questpie.reaction-projection",
		version: 2,
		reactions: [{ identity: "reaction:messagePublished" }],
	});
	expect(runtimeBuild.later.reactionDigest).toMatch(/^[0-9a-f]{64}$/);
	expect(runtimeBuild.inventory).toContainEqual(
		expect.objectContaining({ path: "reaction-projection.json" }),
	);

	const contract = normalizeReactionContract(
		acceptedContract,
		(value) => value,
	);
	const projection = projectReactionContracts([
		{
			identity: "reaction:messagePublished",
			kind: "reaction",
			name: "messagePublished",
			contract,
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
		version: 2,
		reactions: [
			{
				identity: "reaction:messagePublished",
				input: acceptedContract.input,
				output: acceptedContract.output,
				declaredErrors: {},
				runAs: { actor: "caller", whenDenied: "fail" },
				retry: {
					maximumAttempts: 8,
					initialDelayMilliseconds: 1_000,
					backoff: "exponential",
					maximumDelayMilliseconds: 900_000,
					jitter: "full",
					horizonMilliseconds: 86_400_000,
				},
				effects: ["deliver-message"],
				contractDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
				origin: {
					path: "src/message-published.ts",
					exportName: "messagePublished",
					packageId: null,
				},
			},
		],
	});
});

test("rejects a Reaction outside the accepted run-as, retry, and effect contract", () => {
	const normalize = (value: Readonly<Record<string, unknown>>) =>
		normalizeReactionContract(value, (candidate) => candidate);
	expect(() =>
		normalize({ ...acceptedContract, schedule: "0 * * * *" }),
	).toThrow("reaction.schedule is outside the Reaction contract");
	expect(() =>
		normalize({
			...acceptedContract,
			runAs: { kind: "durableRunAs", actor: "system", whenDenied: "fail" },
		}),
	).toThrow('reaction.runAs must be durable.caller({ whenDenied: "fail" })');
	expect(() =>
		normalize({
			...acceptedContract,
			retry: { ...acceptedContract.retry, maximumAttempts: 9 },
		}),
	).toThrow("reaction.retry.maximumAttempts exceeds the accepted 8 bound");
	expect(() =>
		normalize({
			...acceptedContract,
			retry: { ...acceptedContract.retry, maximumDelayMilliseconds: 900_001 },
		}),
	).toThrow("reaction.retry.maximumDelay exceeds the accepted 900000 ms cap");
	expect(() =>
		normalize({ ...acceptedContract, effects: ["Deliver Message"] }),
	).toThrow("reaction.effects[0] is not a literal effect name");
	expect(() =>
		normalize({
			...acceptedContract,
			effects: ["deliver-message", "deliver-message"],
		}),
	).toThrow("reaction.effects contains a duplicate effect name");
});
