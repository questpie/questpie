/**
 * QUE-243: onAfterCommit hook tests
 *
 * Verifies that:
 * 1. Callbacks execute after transaction commits (via withTransaction)
 * 2. Callbacks execute immediately when called outside a transaction
 * 3. Callbacks are discarded when a transaction rolls back
 * 4. Nested transactions queue callbacks to the outermost transaction
 */
import { describe, expect, it } from "bun:test";

import {
	onAfterCommit,
	withTransaction,
} from "../../src/server/collection/crud/shared/transaction.js";

// ============================================================================
// Tests
// ============================================================================

describe("onAfterCommit (QUE-243)", () => {
	it("fires callback after transaction commits", async () => {
		let callbackFired = false;

		const mockDb = {
			transaction: async (fn: (tx: any) => Promise<any>) => {
				return fn({ insert: () => {} });
			},
		};

		await withTransaction(mockDb, async (_tx) => {
			onAfterCommit(async () => {
				callbackFired = true;
			});

			// Callback should NOT have fired yet (still inside transaction)
			expect(callbackFired).toBe(false);
		});

		// After transaction commits, callback should have fired
		expect(callbackFired).toBe(true);
	});

	it("fires immediately when called outside a transaction", async () => {
		let fired = false;

		// Call onAfterCommit outside any transaction — should fire immediately
		onAfterCommit(async () => {
			fired = true;
		});

		// Give the fire-and-forget promise a tick to resolve
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(fired).toBe(true);
	});

	it("discards callbacks when transaction rolls back", async () => {
		let callbackFired = false;

		// Mock db whose transaction method propagates errors (simulating rollback)
		const mockDb = {
			transaction: async (fn: (tx: any) => Promise<any>) => {
				const mockTx = { insert: () => {} };
				return fn(mockTx);
			},
		};

		try {
			await withTransaction(mockDb, async (_tx) => {
				// Queue a callback
				onAfterCommit(async () => {
					callbackFired = true;
				});

				// Simulate an error that causes rollback
				throw new Error("Something went wrong inside transaction");
			});
		} catch {
			// Expected — the transaction failed
		}

		// The callback should NOT have fired because the transaction rolled back
		expect(callbackFired).toBe(false);
	});

	it("fires multiple callbacks in order after commit", async () => {
		const order: number[] = [];

		const mockDb = {
			transaction: async (fn: (tx: any) => Promise<any>) => {
				return fn({ insert: () => {} });
			},
		};

		await withTransaction(mockDb, async (_tx) => {
			onAfterCommit(async () => {
				order.push(1);
			});
			onAfterCommit(async () => {
				order.push(2);
			});
			onAfterCommit(async () => {
				order.push(3);
			});
		});

		expect(order).toEqual([1, 2, 3]);
	});

	it("nested transactions queue callbacks to the outermost transaction", async () => {
		const order: string[] = [];

		const mockDb = {
			transaction: async (fn: (tx: any) => Promise<any>) => {
				return fn({ insert: () => {} });
			},
		};

		await withTransaction(mockDb, async (_tx) => {
			onAfterCommit(async () => {
				order.push("outer-1");
			});

			// Nested transaction — reuses parent
			await withTransaction(mockDb, async (_innerTx) => {
				onAfterCommit(async () => {
					order.push("inner");
				});
			});

			onAfterCommit(async () => {
				order.push("outer-2");
			});

			// None should have fired yet
			expect(order).toEqual([]);
		});

		// All callbacks fire after outermost commits, in registration order
		expect(order).toEqual(["outer-1", "inner", "outer-2"]);
	});
});
