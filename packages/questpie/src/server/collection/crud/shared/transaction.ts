/**
 * Transaction Utilities with AsyncLocalStorage
 *
 * Provides a transaction wrapper that:
 * 1. Automatically propagates transaction context through async calls
 * 2. Supports afterCommit callbacks that run only after outermost transaction commits
 * 3. Handles nested transactions by reusing the parent transaction
 *
 * This solves the problem of operations like search indexing, job dispatching,
 * or email sending that should only run after data is durably committed.
 *
 * ## Why afterCommit?
 *
 * When you dispatch a job, send an email, or call a webhook inside a transaction,
 * there's a risk that the transaction could roll back AFTER the side effect occurred.
 * This leads to inconsistent state - emails sent for orders that don't exist, jobs
 * processing records that were rolled back, etc.
 *
 * `onAfterCommit` queues callbacks to run ONLY after the outermost transaction
 * successfully commits, ensuring side effects only happen when data is durable.
 *
 * ## Usage in Collection/Global Hooks
 *
 * @example
 * ```typescript
 * import { q, onAfterCommit } from "questpie";
 *
 * const orders = q.collection("orders")
 *   .fields({
 *     total: integer("total"),
 *     customerEmail: varchar("customer_email", { length: 255 }),
 *   })
 *   .hooks({
 *     // afterChange runs inside the transaction
 *     afterChange: async ({ data, operation, context }) => {
 *       if (operation === "create") {
 *         // Queue email to send AFTER transaction commits
 *         onAfterCommit(async () => {
 *           await context.app.mailer.send({
 *             to: data.customerEmail,
 *             template: "order-confirmation",
 *             data: { orderId: data.id, total: data.total },
 *           });
 *         });
 *
 *         // Queue background job AFTER transaction commits
 *         onAfterCommit(async () => {
 *           await context.app.queue.add("process-order", {
 *             orderId: data.id,
 *           });
 *         });
 *       }
 *     },
 *   });
 * ```
 *
 * ## Usage in Custom Functions
 *
 * @example
 * ```typescript
 * import { q, onAfterCommit, withTransaction } from "questpie";
 *
 * const checkout = q.fn({
 *   schema: z.object({ cartId: z.string() }),
 *   handler: async ({ input, context }) => {
 *     const { db, app } = context;
 *
 *     return withTransaction(db, async (tx) => {
 *       // Create order
 *       const order = await app.api.collections.orders.create(
 *         { cartId: input.cartId, status: "pending" },
 *         { db: tx }
 *       );
 *
 *       // Deduct inventory (nested CRUD - reuses same transaction)
 *       for (const item of order.items) {
 *         await app.api.collections.products.updateById(
 *           { id: item.productId, data: { stock: sql`stock - ${item.qty}` } },
 *           { db: tx }
 *         );
 *       }
 *
 *       // Queue notifications AFTER everything commits
 *       onAfterCommit(async () => {
 *         await app.queue.add("send-order-confirmation", { orderId: order.id });
 *         await app.queue.add("notify-warehouse", { orderId: order.id });
 *       });
 *
 *       return order;
 *     });
 *   },
 * });
 * ```
 *
 * ## Nested Transactions
 *
 * @example
 * ```typescript
 * // Nested transactions automatically reuse the parent transaction
 * // All onAfterCommit callbacks queue to the outermost transaction
 *
 * await withTransaction(db, async (tx) => {
 *   await createOrder(tx);
 *   onAfterCommit(() => console.log("1")); // Queued
 *
 *   await withTransaction(db, async (sameTx) => {
 *     // sameTx === tx (same transaction reference)
 *     await updateInventory(sameTx);
 *     onAfterCommit(() => console.log("2")); // Also queued to parent
 *   });
 *
 *   onAfterCommit(() => console.log("3")); // Queued
 * });
 * // After commit: prints "1", "2", "3" in order
 * ```
 *
 * ## Behavior Outside Transactions
 *
 * If `onAfterCommit` is called outside any transaction, the callback runs
 * immediately (fire-and-forget). This makes it safe to use in code that
 * may or may not be wrapped in a transaction.
 *
 * @module
 */

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Transaction context stored in AsyncLocalStorage
 */
export interface TransactionContext {
  /** The active database transaction */
  tx: any;
  /** Callbacks to run after the outermost transaction commits */
  afterCommit: Array<() => Promise<void>>;
}

/**
 * AsyncLocalStorage instance for transaction context propagation
 */
const transactionStorage = new AsyncLocalStorage<TransactionContext>();

/**
 * Get the current transaction context if one exists
 *
 * @returns The current transaction context or undefined if not in a transaction
 */
export function getTransactionContext(): TransactionContext | undefined {
  return transactionStorage.getStore();
}

/**
 * Get the current transaction if one exists
 *
 * Useful for checking if we're inside a transaction without needing
 * the full context.
 *
 * @returns The current transaction or undefined
 */
export function getCurrentTransaction(): any | undefined {
  return transactionStorage.getStore()?.tx;
}

/**
 * Check if we're currently inside a transaction
 *
 * @returns true if inside a transaction, false otherwise
 */
export function isInTransaction(): boolean {
  return transactionStorage.getStore() !== undefined;
}

/**
 * Queue a callback to run after the outermost transaction commits
 *
 * If called outside a transaction, the callback runs immediately.
 * If called inside a transaction (including nested), the callback is queued
 * and will run only after the outermost transaction successfully commits.
 *
 * **Use this for any side effect that should only happen when data is durable:**
 * - Dispatching background jobs
 * - Sending emails or push notifications
 * - Calling external webhooks/APIs
 * - Search indexing
 * - Analytics/logging to external systems
 *
 * **Why not just put these after the transaction?**
 * In hooks (afterChange, afterCreate, etc.), you're already inside the CRUD
 * transaction. You can't "step outside" it. `onAfterCommit` lets you queue
 * work to run after the hook's parent transaction commits.
 *
 * @param callback - Async function to run after commit
 *
 * @example
 * ```typescript
 * // In a collection hook
 * .hooks({
 *   afterChange: async ({ data, context }) => {
 *     // This runs inside the transaction - DON'T dispatch jobs here directly!
 *
 *     // Instead, queue for after commit:
 *     onAfterCommit(async () => {
 *       await context.app.queue.add("sync-to-external", { id: data.id });
 *       await fetch("https://webhook.site/...", {
 *         method: "POST",
 *         body: JSON.stringify(data),
 *       });
 *     });
 *   },
 * })
 * ```
 *
 * @example
 * ```typescript
 * // In a custom withTransaction block
 * await withTransaction(db, async (tx) => {
 *   const order = await tx.insert(orders).values(data).returning();
 *
 *   onAfterCommit(async () => {
 *     await mailer.send({ to: order.email, template: "order-confirmed" });
 *   });
 *
 *   return order;
 * });
 * // Email is sent here, after transaction committed
 * ```
 */
export function onAfterCommit(callback: () => Promise<void>): void {
  const ctx = transactionStorage.getStore();

  if (ctx) {
    // Inside a transaction - queue for later
    ctx.afterCommit.push(callback);
  } else {
    // Outside transaction - run immediately (fire and forget)
    // We don't await here to match the "after commit" semantics
    // where the main operation has already "completed"
    callback().catch((error) => {
      console.error(
        "[onAfterCommit] Callback failed outside transaction:",
        error,
      );
    });
  }
}

/**
 * Execute a function within a database transaction
 *
 * Features:
 * - Automatically propagates transaction context via AsyncLocalStorage
 * - Nested calls reuse the parent transaction (no savepoints needed)
 * - afterCommit callbacks only run after outermost transaction commits
 * - If transaction fails, no afterCommit callbacks are executed
 *
 * @param db - Database instance with transaction support
 * @param fn - Function to execute within the transaction
 * @returns The result of the function
 *
 * @example
 * ```typescript
 * // Simple usage
 * const user = await withTransaction(db, async (tx) => {
 *   return tx.insert(users).values({ name: 'John' }).returning();
 * });
 *
 * // With afterCommit
 * const order = await withTransaction(db, async (tx) => {
 *   const order = await tx.insert(orders).values(data).returning();
 *
 *   onAfterCommit(async () => {
 *     await sendOrderConfirmationEmail(order);
 *   });
 *
 *   return order;
 * });
 *
 * // Nested transactions
 * await withTransaction(db, async (tx) => {
 *   await createUser(tx); // Uses this transaction
 *
 *   // This reuses parent transaction
 *   await withTransaction(db, async (sameTx) => {
 *     await createProfile(sameTx);
 *   });
 * });
 * ```
 */
export async function withTransaction<T>(
  db: any,
  fn: (tx: any) => Promise<T>,
): Promise<T> {
  const existingCtx = transactionStorage.getStore();

  if (existingCtx) {
    // Already in a transaction - reuse it (no nested transaction needed)
    // afterCommit callbacks added here will be queued to the existing context
    return fn(existingCtx.tx);
  }

  // New top-level transaction
  const ctx: TransactionContext = {
    tx: null as any,
    afterCommit: [],
  };

  // Execute transaction within the AsyncLocalStorage context
  const result = await transactionStorage.run(ctx, async () => {
    return db.transaction(async (tx: any) => {
      ctx.tx = tx;
      return fn(tx);
    });
  });

  // Transaction committed successfully - run afterCommit callbacks
  // These run sequentially to maintain predictable ordering
  for (const callback of ctx.afterCommit) {
    try {
      await callback();
    } catch (error) {
      // Log but don't throw - the main transaction already committed
      // The caller should handle any critical failures in the callback itself
      console.error("[withTransaction] afterCommit callback failed:", error);
    }
  }

  return result;
}

/**
 * Execute a function within a transaction, optionally reusing an existing one
 *
 * This is useful when you have a db instance that might already be a transaction
 * (e.g., passed via context.db). It will:
 * 1. If already in a transaction context, reuse it
 * 2. If db looks like a transaction, use it directly
 * 3. Otherwise, start a new transaction
 *
 * @param db - Database instance (might be a transaction already)
 * @param fn - Function to execute
 * @returns The result of the function
 */
export async function withTransactionOrExisting<T>(
  db: any,
  fn: (tx: any) => Promise<T>,
): Promise<T> {
  const existingCtx = transactionStorage.getStore();

  if (existingCtx) {
    // Already in a managed transaction context - reuse
    return fn(existingCtx.tx);
  }

  // Check if db is already a transaction (has rollback method but no transaction method,
  // or is the same reference as would be created)
  // This handles the case where context.db is passed as a transaction
  const isLikelyTransaction =
    db.rollback && typeof db.transaction !== "function";

  if (isLikelyTransaction) {
    // db is already a transaction, use it directly
    // Note: afterCommit won't work properly here since we're not managing it
    return fn(db);
  }

  // Start a new managed transaction
  return withTransaction(db, fn);
}
