import { describe, expect, test } from "bun:test";

import { probeSessionAffinity } from "../../packages/compiler/src/postgres-session";

describe("BETA-02 PostgreSQL session protocol", () => {
	test("commits two probes and accepts only one pinned backend", async () => {
		const observed: number[] = [];
		const pid = await probeSessionAffinity(async () => {
			observed.push(observed.length + 1);
			return 4172;
		});

		expect(pid).toBe(4172);
		expect(observed).toEqual([1, 2]);
	});

	test("rejects a provider that changes backend between committed probes", async () => {
		const pids = [4172, 4173];

		await expect(
			probeSessionAffinity(async () => pids.shift() ?? -1),
		).rejects.toMatchObject({
			code: "QP-SCHEMA-007",
			diagnosticClass: "providerMismatch",
		});
	});
});
