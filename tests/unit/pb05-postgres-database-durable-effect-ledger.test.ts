import { expect, test } from "bun:test";

import type { SQL } from "bun";

import { createPostgresDurableEffectLedger } from "../../packages/runtime/src/durable/postgres-effects";
import {
	durableEffectAmbiguous,
	durableEffectFence,
	durableEffectRead,
	durableEffectReservationInsert,
	durableEffectReservationRead,
	durableEffectSettle,
	durableKernelMarker,
} from "../../packages/runtime/src/durable/postgres-statements";
import type { DurableClaim } from "../../packages/runtime/src/durable/rows";

const application = "application:collaboration";
const effectId = "64a789a4-c319-5d2b-ac27-520d9808a941";
const inputDigest =
	"8511a4633e1124451288e6801dd0f73f027c843498639d8de0931303667e1d42";
const claim = Object.freeze({
	runId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
	dispatchId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a1",
	resource: "reaction:message.published",
	attemptId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2",
	leaseToken: "lease:pb05",
	causationId: "call:pb05",
	correlationId: "call:pb05",
} as DurableClaim);

test("effect-ledger facade composes all operations with exact transaction modes", async () => {
	const statements: string[][] = [];
	const parameters: unknown[][][] = [];
	const result = (
		command: string,
		rows: readonly (readonly unknown[])[],
		count = rows.length,
	) => Object.assign([...rows], { command, count });
	const sql = {
		begin: async (use: (session: unknown) => Promise<unknown>) => {
			const transactionStatements: string[] = [];
			const transactionParameters: unknown[][] = [];
			statements.push(transactionStatements);
			parameters.push(transactionParameters);
			return use({
				unsafe(statement: string, values: readonly unknown[] = []) {
					transactionStatements.push(statement);
					transactionParameters.push([...values]);
					return {
						async values() {
							if (statement === "SET TRANSACTION READ ONLY")
								return result("SET", [], 0);
							if (statement === durableKernelMarker.text)
								return result("SELECT", [["on"]]);
							if (statement === durableEffectFence.text)
								return result("SELECT", [[1]]);
							if (statement === durableEffectReservationInsert.text)
								return result("INSERT", [], 1);
							if (statement === durableEffectReservationRead.text)
								return result("SELECT", [
									[effectId, "pending", null, inputDigest],
								]);
							if (statement === durableEffectSettle.text)
								return result("UPDATE", []);
							if (statement === durableEffectAmbiguous.text)
								return result("UPDATE", []);
							if (statement === durableEffectRead.text)
								return result("SELECT", [
									["deliver", effectId, "pending", null],
								]);
							throw new TypeError("unexpected effect-ledger statement");
						},
					};
				},
			});
		},
	} as unknown as SQL;
	const ledger = createPostgresDurableEffectLedger({ sql, application });

	await expect(
		ledger.reserve(claim, {
			effectName: "deliver",
			input: { messageId: "m1" },
		}),
	).resolves.toEqual({ status: "reserved", effectId });
	await expect(
		ledger.settle(claim, { effectName: "deliver", receipt: "provider:r1" }),
	).resolves.toBe("applied");
	await expect(
		ledger.markAmbiguous(claim, { effectName: "deliver" }),
	).resolves.toBe("applied");
	await expect(ledger.read(claim.runId)).resolves.toEqual([
		{ effectName: "deliver", effectId, status: "pending", receipt: null },
	]);

	expect(statements).toEqual([
		[
			durableKernelMarker.text,
			durableEffectFence.text,
			durableEffectReservationInsert.text,
			durableEffectReservationRead.text,
		],
		[
			durableKernelMarker.text,
			durableEffectFence.text,
			durableEffectSettle.text,
		],
		[
			durableKernelMarker.text,
			durableEffectFence.text,
			durableEffectAmbiguous.text,
		],
		["SET TRANSACTION READ ONLY", durableEffectRead.text],
	]);
	expect(parameters[3]?.[0]).toEqual([]);
});
