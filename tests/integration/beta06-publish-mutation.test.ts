import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { compileApplication, loadCommittedMigration } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

test("projects the authored message.publish Mutation into the executable application", async () => {
	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	const runtimeExecutables = JSON.parse(
		compilation.generatedFiles["runtime-executables.json"]!,
	) as Readonly<{
		slots: readonly Readonly<{
			identity: string;
			kind: string;
			slot: string;
		}>[];
	}>;
	const wire = JSON.parse(compilation.generatedFiles["wire-contract.json"]!) as
		| Readonly<{
				operations: readonly Readonly<{ identity: string }>[];
		  }>
		| undefined;
	const projection = JSON.parse(
		compilation.generatedFiles["mutation-projection.json"]!,
	) as Readonly<{
		mutations: readonly Readonly<{
			identity: string;
			mode: string;
			errors: readonly Readonly<{ code: string; status: number }>[];
		}>[];
	}>;
	const transactions = JSON.parse(
		compilation.generatedFiles["mutation-transaction-plans.json"]!,
	) as Readonly<{ plans: readonly unknown[] }>;
	const policies = JSON.parse(
		compilation.generatedFiles["policy-projection.json"]!,
	) as Readonly<{
		policies: readonly Readonly<{
			program: Readonly<{
				identity: string;
				operations: Readonly<Record<string, unknown>>;
			}>;
			scopeBindings: readonly Readonly<{
				scope: string;
				parentScope: string | null;
			}>[];
		}>[];
	}>;

	expect(runtimeExecutables.slots).toContainEqual(
		expect.objectContaining({
			identity: "mutation:message.publish",
			kind: "mutation",
			slot: "handler",
		}),
	);
	expect(wire?.operations).toContainEqual(
		expect.objectContaining({
			identity: "mutation:message.publish",
			declaredErrors: {
				channelUnavailable: expect.objectContaining({
					code: "CHANNEL_UNAVAILABLE",
					status: 404,
				}),
				idempotencyConflict: expect.objectContaining({
					code: "IDEMPOTENCY_CONFLICT",
					status: 409,
				}),
			},
		}),
	);
	expect(compilation.generatedFiles["app.ts"]).toContain(
		'readonly "message.publish"',
	);
	expect(compilation.generatedFiles["client.ts"]).toContain(
		'"message.publish": (operationInput:',
	);
	expect(projection.mutations).toContainEqual(
		expect.objectContaining({
			identity: "mutation:message.publish",
			mode: "writeTransaction",
			errors: expect.arrayContaining([
				expect.objectContaining({
					code: "IDEMPOTENCY_CONFLICT",
					status: 409,
				}),
			]),
		}),
	);
	expect(transactions.plans).toContainEqual(
		expect.objectContaining({
			owner: "mutation:message.publish",
			isolation: "readCommitted",
			rootTransactions: 1,
			savepoints: "notAvailable",
			dispatch: {
				status: "intentOnly",
				writtenInOwnerTransaction: true,
			},
		}),
	);
	expect(policies.policies.map(({ program }) => program.identity)).toEqual([
		"policy:channels.default",
		"policy:memberships.default",
		"policy:messageEvents.default",
		"policy:messages.default",
		"policy:spaces.default",
	]);
	const messagePolicy = policies.policies.find(
		({ program }) => program.identity === "policy:messages.default",
	)!;
	expect(messagePolicy.program.operations).toMatchObject({
		create: {
			admission: { kind: "authenticated" },
			candidate: { kind: "and" },
		},
		read: { admission: { kind: "authenticated" } },
	});
	expect(messagePolicy.scopeBindings).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ scope: "candidate", parentScope: null }),
			expect.objectContaining({ scope: "row", parentScope: null }),
		]),
	);
	const migrationRoot = resolve(
		fixtureRoot,
		"questpie/migrations/000003_publish-message-transaction",
	);
	const migration = await loadCommittedMigration(migrationRoot);
	expect(migration.plan.baseMigration).toBe("000002_authorize-message-pages");
	expect(
		await readFile(resolve(migrationRoot, "target-schema.json"), "utf8"),
	).toBe(compilation.generatedFiles["schema-projection.json"]);
});
