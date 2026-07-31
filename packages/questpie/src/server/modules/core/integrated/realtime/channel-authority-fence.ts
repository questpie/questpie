import { createHash } from "node:crypto";

import { and, eq, gt, ne, sql } from "drizzle-orm";

import {
	withTransaction,
	withTransactionOrExisting,
} from "#questpie/server/collection/crud/shared/transaction.js";
import type { AnyDrizzleClient } from "#questpie/server/config/types.js";

import {
	questpieChannelAuthorityFenceTable,
	questpieChannelAuthorityRevocationTable,
} from "./collection.js";

export type ChannelAuthorityFenceKey = Readonly<{
	channelHash: string;
	subject: string;
}>;

export type ChannelAuthorityFenceReceipt = Readonly<{
	generation: number;
	applied: boolean;
}>;

export type ChannelAuthorityAdmission<T> =
	| Readonly<{ admitted: false }>
	| Readonly<{ admitted: true; value: T }>;

const CHANNEL_COORDINATOR_SUBJECT = "channel-authority-coordinator";

function assertOpaqueSubject(subject: string): void {
	if (!subject || subject.length > 256) {
		throw new Error("Channel authority subject is invalid");
	}
}

function idempotencyHash(idempotencyKey: string): string {
	if (!idempotencyKey || idempotencyKey.length > 256) {
		throw new Error("Channel authority idempotency key is invalid");
	}
	return createHash("sha256").update(idempotencyKey).digest("hex");
}

/** Durable generation store and database linearization point for channel access. */
export class ChannelAuthorityFenceStore {
	constructor(private readonly db: AnyDrizzleClient<any>) {}

	async ensure(input: ChannelAuthorityFenceKey): Promise<number> {
		assertOpaqueSubject(input.subject);
		await Promise.all([
			this.ensureRow(input, this.db),
			this.ensureChannel(input.channelHash, this.db),
		]);
		return this.read(input);
	}

	async ensureChannel(
		channelHash: string,
		db: AnyDrizzleClient<any> = this.db,
	): Promise<void> {
		await this.ensureRow(
			{ channelHash, subject: CHANNEL_COORDINATOR_SUBJECT },
			db,
		);
	}

	async advance(
		input: ChannelAuthorityFenceKey & { idempotencyKey: string },
		db: AnyDrizzleClient<any> = this.db,
	): Promise<ChannelAuthorityFenceReceipt> {
		assertOpaqueSubject(input.subject);
		const commandHash = idempotencyHash(input.idempotencyKey);
		return withTransactionOrExisting(db, async (tx) => {
			const [inserted] = await tx
				.insert(questpieChannelAuthorityRevocationTable)
				.values({
					idempotencyHash: commandHash,
					channelHash: input.channelHash,
					subject: input.subject,
				})
				.onConflictDoNothing()
				.returning({
					idempotencyHash:
						questpieChannelAuthorityRevocationTable.idempotencyHash,
				});
			if (!inserted) {
				const [existing] = await tx
					.select({
						channelHash: questpieChannelAuthorityRevocationTable.channelHash,
						subject: questpieChannelAuthorityRevocationTable.subject,
						generation: questpieChannelAuthorityRevocationTable.generation,
						applied: questpieChannelAuthorityRevocationTable.applied,
					})
					.from(questpieChannelAuthorityRevocationTable)
					.where(
						eq(
							questpieChannelAuthorityRevocationTable.idempotencyHash,
							commandHash,
						),
					)
					.limit(1);
				if (
					!existing ||
					existing.channelHash !== input.channelHash ||
					existing.subject !== input.subject
				) {
					throw new Error("Channel authority idempotency key conflicts");
				}
				return {
					generation: Number(existing.generation),
					applied: existing.applied,
				};
			}

			await this.ensureChannel(input.channelHash, tx);
			await this.ensureRow(
				{ channelHash: input.channelHash, subject: input.subject },
				tx,
			);
			const [coordinator] = await tx
				.update(questpieChannelAuthorityFenceTable)
				.set({
					generation: sql`${questpieChannelAuthorityFenceTable.generation} + 1`,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(
							questpieChannelAuthorityFenceTable.channelHash,
							input.channelHash,
						),
						eq(
							questpieChannelAuthorityFenceTable.subject,
							CHANNEL_COORDINATOR_SUBJECT,
						),
					),
				)
				.returning({
					generation: questpieChannelAuthorityFenceTable.generation,
				});
			if (!coordinator)
				throw new Error("Channel authority fence is unavailable");
			const generation = Number(coordinator.generation);
			await tx
				.update(questpieChannelAuthorityFenceTable)
				.set({ generation, updatedAt: new Date() })
				.where(
					and(
						eq(
							questpieChannelAuthorityFenceTable.channelHash,
							input.channelHash,
						),
						eq(questpieChannelAuthorityFenceTable.subject, input.subject),
					),
				);
			await tx
				.update(questpieChannelAuthorityRevocationTable)
				.set({ generation })
				.where(
					eq(
						questpieChannelAuthorityRevocationTable.idempotencyHash,
						commandHash,
					),
				);
			return { generation, applied: false };
		});
	}

	async acknowledge(
		input: ChannelAuthorityFenceKey & {
			idempotencyKey: string;
			generation: number;
		},
		db: AnyDrizzleClient<any> = this.db,
	): Promise<void> {
		const commandHash = idempotencyHash(input.idempotencyKey);
		await withTransactionOrExisting(db, async (tx) => {
			const [command] = await tx
				.select()
				.from(questpieChannelAuthorityRevocationTable)
				.where(
					eq(
						questpieChannelAuthorityRevocationTable.idempotencyHash,
						commandHash,
					),
				)
				.limit(1)
				.for("update");
			if (
				!command ||
				command.channelHash !== input.channelHash ||
				command.subject !== input.subject ||
				Number(command.generation) !== input.generation
			) {
				throw new Error("Channel authority acknowledgement is invalid");
			}
			if (command.applied) return;
			await tx
				.update(questpieChannelAuthorityFenceTable)
				.set({
					appliedGeneration: sql`greatest(
						${questpieChannelAuthorityFenceTable.appliedGeneration},
						${input.generation}
					)`,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(
							questpieChannelAuthorityFenceTable.channelHash,
							input.channelHash,
						),
						eq(questpieChannelAuthorityFenceTable.subject, input.subject),
					),
				);
			await tx
				.update(questpieChannelAuthorityRevocationTable)
				.set({ applied: true })
				.where(
					eq(
						questpieChannelAuthorityRevocationTable.idempotencyHash,
						commandHash,
					),
				);
		});
	}

	/** Admit one provider dispatch without holding a database lock across I/O. */
	async admitSharedDispatch(channelHash: string): Promise<boolean> {
		return withTransaction(this.db, async (tx) => {
			await this.ensureChannel(channelHash, tx);
			await tx
				.select({ generation: questpieChannelAuthorityFenceTable.generation })
				.from(questpieChannelAuthorityFenceTable)
				.where(
					and(
						eq(questpieChannelAuthorityFenceTable.channelHash, channelHash),
						eq(
							questpieChannelAuthorityFenceTable.subject,
							CHANNEL_COORDINATOR_SUBJECT,
						),
					),
				)
				.limit(1)
				.for("share");
			const [pending] = await tx
				.select({ subject: questpieChannelAuthorityFenceTable.subject })
				.from(questpieChannelAuthorityFenceTable)
				.where(
					and(
						eq(questpieChannelAuthorityFenceTable.channelHash, channelHash),
						ne(
							questpieChannelAuthorityFenceTable.subject,
							CHANNEL_COORDINATOR_SUBJECT,
						),
						gt(
							questpieChannelAuthorityFenceTable.generation,
							questpieChannelAuthorityFenceTable.appliedGeneration,
						),
					),
				)
				.limit(1);
			return !pending;
		});
	}

	/**
	 * Publish framework-owned state only if a fresh, externally evaluated
	 * policy result still targets the current authority generation.
	 */
	async admitExpected<T>(
		input: ChannelAuthorityFenceKey & { expectedGeneration: number },
		publication: {
			/** Optional owned SQL which must lock a resource before the fences. */
			beforeFence?: (tx: AnyDrizzleClient<any>) => Promise<void>;
			/** Owned SQL and synchronous handle publication only. */
			publish: (tx: AnyDrizzleClient<any>) => Promise<T> | T;
		},
	): Promise<ChannelAuthorityAdmission<T>> {
		assertOpaqueSubject(input.subject);
		return withTransaction(this.db, async (tx) => {
			await publication.beforeFence?.(tx);
			const [coordinator] = await tx
				.select({ generation: questpieChannelAuthorityFenceTable.generation })
				.from(questpieChannelAuthorityFenceTable)
				.where(
					and(
						eq(
							questpieChannelAuthorityFenceTable.channelHash,
							input.channelHash,
						),
						eq(
							questpieChannelAuthorityFenceTable.subject,
							CHANNEL_COORDINATOR_SUBJECT,
						),
					),
				)
				.limit(1)
				.for("share");
			if (!coordinator) {
				throw new Error("Channel authority coordinator is unavailable");
			}
			const [row] = await tx
				.select({ generation: questpieChannelAuthorityFenceTable.generation })
				.from(questpieChannelAuthorityFenceTable)
				.where(
					and(
						eq(
							questpieChannelAuthorityFenceTable.channelHash,
							input.channelHash,
						),
						eq(questpieChannelAuthorityFenceTable.subject, input.subject),
					),
				)
				.limit(1)
				.for("share");
			if (!row) throw new Error("Channel authority fence is unavailable");
			if (Number(row.generation) !== input.expectedGeneration) {
				return { admitted: false };
			}
			return {
				admitted: true,
				value: await publication.publish(tx),
			};
		});
	}

	async read(input: ChannelAuthorityFenceKey): Promise<number> {
		const [row] = await this.db
			.select({ generation: questpieChannelAuthorityFenceTable.generation })
			.from(questpieChannelAuthorityFenceTable)
			.where(
				and(
					eq(questpieChannelAuthorityFenceTable.channelHash, input.channelHash),
					eq(questpieChannelAuthorityFenceTable.subject, input.subject),
				),
			)
			.limit(1);
		if (!row) throw new Error("Channel authority fence is unavailable");
		return Number(row.generation);
	}

	private async ensureRow(
		input: ChannelAuthorityFenceKey,
		db: AnyDrizzleClient<any>,
	): Promise<void> {
		await db
			.insert(questpieChannelAuthorityFenceTable)
			.values({ ...input, generation: 0, appliedGeneration: 0 })
			.onConflictDoNothing();
	}
}
