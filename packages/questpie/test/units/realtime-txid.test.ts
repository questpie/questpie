import { describe, expect, it } from "bun:test";

import { assertPostgres13ForRealtimeTxid } from "../../src/server/db/postgres-version.js";
import { questpieRealtimeLogTable } from "../../src/server/modules/core/integrated/realtime/collection.js";

describe("realtime txid PostgreSQL contract", () => {
	it("fails fast below PostgreSQL 13 with a clear requirement", async () => {
		const db = {
			execute: async () => ({ rows: [{ serverVersionNum: "120019" }] }),
		};

		await expect(assertPostgres13ForRealtimeTxid(db)).rejects.toThrow(
			"QUESTPIE realtime txid requires PostgreSQL 13 or newer",
		);
	});

	it("accepts PostgreSQL 13+ and maps xid8 driver values to strings", async () => {
		const db = {
			execute: async () => ({ rows: [{ serverVersionNum: 130000 }] }),
		};

		await expect(assertPostgres13ForRealtimeTxid(db)).resolves.toBeUndefined();
		expect(questpieRealtimeLogTable.txid.mapFromDriverValue(42n)).toBe("42");
	});
});
