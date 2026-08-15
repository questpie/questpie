import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

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
});
