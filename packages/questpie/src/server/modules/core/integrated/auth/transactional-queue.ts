import type { BetterAuthPlugin, DBTransactionAdapter } from "better-auth";

import { withTransaction } from "#questpie/server/collection/crud/shared/transaction.js";
import type {
	JobDefinition,
	QueueClient,
	QueueConfig,
} from "#questpie/server/modules/core/integrated/queue/types.js";

type RegisteredJobs = QueueConfig["jobs"];

export interface AuthTransactionalQueueContext {
	context: {
		adapter: {
			transaction: <T>(
				callback: (auth: DBTransactionAdapter) => Promise<T>,
			) => Promise<T>;
		};
	};
}

export interface AuthTransactionalQueuePublishOptions {
	/** Stable, non-secret identity for one logical verification dispatch. */
	idempotencyKey: string;
}

export type AuthTransactionalQueuePublish = <
	TPayload,
	TResult,
	TName extends string,
>(
	job: JobDefinition<TPayload, TResult, TName>,
	payload: TPayload,
	options: AuthTransactionalQueuePublishOptions,
) => Promise<string>;

// Bind through Better Auth's stable adapter identity without adding an
// enumerable or reflectable capability to the shared plugin context.
const authTransactionalQueuePublishers = new WeakMap<
	object,
	AuthTransactionalQueuePublish
>();

export interface AuthTransactionalQueueTransaction {
	/** Transaction-scoped Better Auth adapter for the protected Auth mutation. */
	auth: DBTransactionAdapter;
	/** Publish one registered, typed job as an encrypted durable dispatch. */
	publish: AuthTransactionalQueuePublish;
}

/**
 * Commit a Better Auth mutation and an encrypted Queue dispatch atomically.
 *
 * The callback sees only Better Auth's transaction adapter and a publisher for
 * concrete job definitions registered by the app. Provider calls belong in the
 * job handler, after this transaction commits.
 */
export async function withAuthTransactionalQueue<T>(
	ctx: AuthTransactionalQueueContext,
	callback: (transaction: AuthTransactionalQueueTransaction) => Promise<T>,
): Promise<T> {
	const publish = authTransactionalQueuePublishers.get(ctx.context.adapter);
	if (!publish) {
		throw new Error(
			"QUESTPIE: Auth transactional Queue bridge is unavailable on this Auth context",
		);
	}

	return ctx.context.adapter.transaction(async (auth) => {
		return callback({ auth, publish });
	});
}

function createAuthTransactionalQueuePublish(options: {
	jobs: RegisteredJobs;
	getQueue: () => QueueClient<RegisteredJobs>;
}): AuthTransactionalQueuePublish {
	return async (definition, payload, publishOptions) => {
		if (!publishOptions.idempotencyKey.trim()) {
			throw new Error(
				"QUESTPIE: Auth transactional Queue publication requires a non-empty idempotencyKey",
			);
		}

		const registered = Object.values(options.jobs).find(
			(job) => job.name === definition.name,
		);
		if (registered !== definition) {
			throw new Error(
				`QUESTPIE: Auth transactional Queue job "${definition.name}" is not registered by this app`,
			);
		}

		const client = options.getQueue()[definition.name];
		if (!client) {
			throw new Error(
				`QUESTPIE: Auth transactional Queue job "${definition.name}" has no Queue client`,
			);
		}

		const dispatchId = await client.publish(payload, {
			idempotencyKey: publishOptions.idempotencyKey,
			secretPayload: true,
		});
		if (!dispatchId) {
			throw new Error(
				`QUESTPIE: Auth transactional Queue job "${definition.name}" did not return a durable dispatch id`,
			);
		}
		return dispatchId;
	};
}

/** @internal Better Auth plugin that binds the app's narrow Queue capability. */
export function createAuthTransactionalQueuePlugin(options: {
	jobs: RegisteredJobs;
	getQueue: () => QueueClient<RegisteredJobs>;
}): BetterAuthPlugin {
	return {
		id: "questpie-auth-transactional-queue",
		init(context) {
			authTransactionalQueuePublishers.set(
				context.adapter,
				createAuthTransactionalQueuePublish(options),
			);
		},
	};
}

/**
 * Preserve Drizzle's complete database surface while joining Better Auth's
 * adapter transaction to QUESTPIE's ambient transaction context.
 *
 * @internal
 */
export function createAuthTransactionalDatabase<TDatabase extends object>(
	database: TDatabase,
): TDatabase {
	return new Proxy(database, {
		get(target, property, receiver) {
			if (property === "transaction") {
				return <T>(callback: (transaction: unknown) => Promise<T>) =>
					withTransaction(target, callback);
			}
			return Reflect.get(target, property, receiver);
		},
	});
}
