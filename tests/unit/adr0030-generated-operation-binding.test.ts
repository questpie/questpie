import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

test("binds Collection Operation Set writes as ordinary exact Operations", async () => {
	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
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
		declaredErrors: {
			channelUnavailable: {
				code: "CHANNEL_UNAVAILABLE",
				payload: null,
				status: 404,
			},
			invalidMessageEvent: {
				code: "INVALID_MESSAGE_EVENT",
				payload: null,
				status: 422,
			},
		},
		issueMappings: {
			"collection:messageEvents": {
				"issue:messageEvents/invalidKind": "invalidMessageEvent",
			},
			"collection:messages": {
				"issue:messages/channelUnavailable": "channelUnavailable",
			},
		},
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
				body: {
					kind: "optional",
					codec: { kind: "text", minLength: 1, maxLength: 8_192 },
				},
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

test("publishes only explicitly networked generated writes", async () => {
	const temporary = await mkdtemp(
		join(tmpdir(), "questpie-operation-binding-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const sourcePath = join(temporary, "src/message-operations.ts");
		const source = await readFile(sourcePath, "utf8");
		await writeFile(
			sourcePath,
			source.replace(
				'name: "messages",\n\tpolicy: messagePolicy,',
				'name: "messages",\n\tpolicy: messagePolicy,\n\tnetwork: true,',
			),
		);
		const compilation = await compileApplication({
			applicationRoot: temporary,
		});
		const wire = JSON.parse(
			compilation.generatedFiles["wire-contract.json"] ?? "null",
		) as Readonly<{ operations: readonly Readonly<{ identity: string }>[] }>;
		expect(
			wire.operations.some(
				({ identity }) => identity === "mutation:messages.create",
			),
		).toBe(true);
		expect(compilation.generatedFiles["client.ts"]).toContain(
			'"messages.create"',
		);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
});
