import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

test("binds Collection Operation Set writes as ordinary exact Operations", async () => {
	const compilation = await compileApplication({ applicationRoot: fixtureRoot });
	const contracts = JSON.parse(
		compilation.generatedFiles["operation-contracts.json"] ?? "null",
	) as Readonly<{
		operations: readonly Readonly<{
			identity: string;
			input: unknown;
			output: unknown;
		}>[];
	}>;
	const wire = JSON.parse(
		compilation.generatedFiles["wire-contract.json"] ?? "null",
	) as Readonly<{ operations: readonly Readonly<{ identity: string }>[] }>;
	const executables = JSON.parse(
		compilation.generatedFiles["runtime-executables.json"] ?? "null",
	) as Readonly<{
		slots: readonly Readonly<{
			identity: string;
			bundleExport: string;
		}>[];
	}>;
	const create = contracts.operations.find(
		({ identity }) => identity === "mutation:messages.create",
	);

	expect(create).toEqual({
		identity: "mutation:messages.create",
		admission: "authenticated",
		declaredErrors: {},
		input: {
			kind: "object",
			properties: {
				input: {
					kind: "object",
					properties: {
						authorMembershipId: { kind: "uuid" },
						body: { kind: "text", minLength: 1, maxLength: 8_192 },
						channelId: { kind: "uuid" },
					},
				},
			},
		},
		output: {
			kind: "object",
			properties: {
				body: { kind: "text", minLength: 1, maxLength: 8_192 },
				channelId: { kind: "uuid" },
				createdAt: { kind: "timestamp", withTimezone: true },
				id: { kind: "uuid" },
			},
		},
	});
	expect(
		wire.operations.some(
			({ identity }) => identity === "mutation:messages.create",
		),
	).toBe(false);
	expect(
		executables.slots.filter(
			({ identity }) => identity === "mutation:messages.create",
		),
	).toHaveLength(1);

	const app = compilation.generatedFiles["app.ts"]!;
	const client = compilation.generatedFiles["client.ts"]!;
	const application = compilation.generatedFiles["internal/application.js"]!;
	expect(app).toContain('readonly "messages"');
	expect(app).toContain('readonly "create"');
	expect(application).toContain("executeCollectionOperationAdapter");
	expect(application).toContain('"mutation:messages.create"');
	expect(application).not.toContain("messageOperations.handler");
	expect(client).not.toContain('"messages.create"');
});
