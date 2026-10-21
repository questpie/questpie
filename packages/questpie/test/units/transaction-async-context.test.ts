import { expect, test } from "bun:test";
import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";

import {
	getCurrentTransaction,
	onAfterCommit,
	withTransaction,
} from "../../src/server/collection/crud/shared/transaction.js";

test("a driver callback from a foreign async resource restores both contexts", async () => {
	const foreign = new AsyncResource("foreign-driver");
	const caller = new AsyncLocalStorage<string>();
	const transaction = { execute: async () => {} };
	const driver = {
		transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
			foreign.runInAsyncScope(() => callback(transaction)),
	};
	let committed = false;
	try {
		await caller.run("owner", () =>
			withTransaction(driver, async (tx) => {
				expect(caller.getStore()).toBe("owner");
				expect(getCurrentTransaction()).toBe(tx);
				await withTransaction(driver, async (nested) => {
					expect(nested).toBe(tx);
					expect(caller.getStore()).toBe("owner");
				});
				onAfterCommit(() => {
					expect(getCurrentTransaction()).toBeUndefined();
					expect(caller.getStore()).toBe("owner");
					committed = true;
				});
			}),
		);
		expect(committed).toBe(true);
		expect(caller.getStore()).toBeUndefined();
	} finally {
		foreign.emitDestroy();
	}
});
