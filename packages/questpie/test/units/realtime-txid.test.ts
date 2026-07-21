import { describe, expect, it } from "bun:test";

import { smartResponse } from "../../src/server/adapters/utils/response.js";
import {
	assertPostgres13ForRealtimeTxid,
	QUESTPIE_SCHEMA_INTROSPECTION_ENV,
} from "../../src/server/db/postgres-version.js";
import { questpieRealtimeLogTable } from "../../src/server/modules/core/integrated/realtime/collection.js";
import {
	attachTxid,
	getTxid,
	QUESTPIE_TXID_HEADER,
} from "../../src/shared/txid.js";

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

	it("keeps schema introspection database-free", async () => {
		let executed = false;
		const previous = process.env[QUESTPIE_SCHEMA_INTROSPECTION_ENV];
		process.env[QUESTPIE_SCHEMA_INTROSPECTION_ENV] = "1";

		try {
			await assertPostgres13ForRealtimeTxid({
				execute: async () => {
					executed = true;
					throw new Error("database should not be queried");
				},
			});
		} finally {
			if (previous === undefined) {
				delete process.env[QUESTPIE_SCHEMA_INTROSPECTION_ENV];
			} else {
				process.env[QUESTPIE_SCHEMA_INTROSPECTION_ENV] = previous;
			}
		}

		expect(executed).toBe(false);
	});

	it("attaches transaction metadata without changing JSON output", () => {
		const value = { id: "post", title: "Post" };

		expect(attachTxid(value, "77")).toBe(value);
		expect(getTxid(value)).toBe("77");
		expect(Object.keys(value)).toEqual(["id", "title"]);
		expect(JSON.stringify(value)).toBe('{"id":"post","title":"Post"}');
		expect(QUESTPIE_TXID_HEADER).toBe("X-Questpie-Txid");
	});

	it("adds transaction metadata to a smart response header", () => {
		const response = smartResponse(
			{ success: true },
			new Request("http://localhost"),
			200,
			{ [QUESTPIE_TXID_HEADER]: "77" },
		);

		expect(response.headers.get(QUESTPIE_TXID_HEADER)).toBe("77");
	});
});
