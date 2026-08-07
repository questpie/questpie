import { and, asc, eq, getTableColumns, gt, lte } from "drizzle-orm";

import { mutateCanonicalRow } from "#questpie/server/collection/crud/shared/canonical-mutation.js";
import { onAfterCommit } from "#questpie/server/collection/crud/shared/transaction.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import type { AnyDrizzleClient } from "#questpie/server/config/types.js";
import { hashCrdtCanonicalValue } from "#questpie/shared/crdt-engine.js";

import type { CrdtProjectionOwnerPort } from "./projection-store.js";
import {
	questpieCrdtCommitTable,
	questpieCrdtDefinitionTable,
	questpieCrdtResourceTable,
	questpieCrdtSubjectTable,
} from "./schema.js";

type LockedOwner = {
	kind: "collection" | "global";
	key: string;
	table: any;
	columns: Record<string, any>;
	where: any;
	recordId: string | number | null;
	row: Record<string, unknown>;
};

export function createQuestpieProjectionOwnerPort(
	app: Questpie<any>,
): CrdtProjectionOwnerPort<LockedOwner> {
	const prepareAcknowledgement =
		app.config?.crdt?.projection?.prepareAcknowledgement;
	const preparedOwnerValues = new WeakMap<
		LockedOwner,
		{
			values: Readonly<Record<string, unknown>>;
			crdtPaths: ReadonlySet<string>;
		}
	>();
	return Object.freeze({
		async lock(transaction, { resourceId }) {
			const [identity] = await transaction
				.select({
					ownerKind: questpieCrdtDefinitionTable.ownerKind,
					ownerKey: questpieCrdtDefinitionTable.ownerKey,
					locator: questpieCrdtResourceTable.locator,
				})
				.from(questpieCrdtResourceTable)
				.innerJoin(
					questpieCrdtDefinitionTable,
					eq(
						questpieCrdtDefinitionTable.id,
						questpieCrdtResourceTable.definitionId,
					),
				)
				.where(eq(questpieCrdtResourceTable.id, resourceId));
			if (!identity) throw new Error("CRDT owner identity is unavailable");
			const kind = identity.ownerKind === 1 ? "collection" : "global";
			const entries = Object.entries(
				kind === "collection" ? app.collections : app.globals,
			) as [string, any][];
			const ownerEntry = entries.find(
				([, crud]) => crud?.["~internalState"]?.name === identity.ownerKey,
			);
			if (!ownerEntry) throw new Error("CRDT owner is not registered");
			const [key, crud] = ownerEntry;
			if (crud?.["~internalState"]?.options?.optimisticConcurrency !== true) {
				throw new Error(
					"CRDT canonical owner must enable optimisticConcurrency",
				);
			}
			const versioning = crud["~internalState"].options.versioning;
			if (
				versioning &&
				(versioning === true ||
					versioning.collaborativeSnapshots !== "checkpoint")
			) {
				throw new Error(
					"CRDT version history requires checkpoint snapshot policy",
				);
			}
			const table = crud["~internalRelatedTable"];
			const columns = getTableColumns(table) as Record<string, any>;
			if (kind === "global") {
				if (identity.locator !== '["global"]') {
					throw new Error("CRDT global locator is invalid");
				}
				const rows = await transaction
					.select()
					.from(table)
					.limit(2)
					.for("update");
				if (rows.length !== 1) {
					throw new Error("CRDT global owner is not singleton");
				}
				const primary = columns.id;
				const where = primary ? eq(primary, rows[0]!.id) : undefined;
				if (!where) {
					throw new Error("CRDT global owner has no lock identity");
				}
				return {
					kind,
					key,
					table,
					columns,
					where,
					recordId: null,
					row: rows[0] as Record<string, unknown>,
				};
			}
			const recordId = decodeCollectionLocator(identity.locator);
			const id = columns.id;
			if (!id) throw new Error("CRDT collection owner has no id column");
			const where = eq(id, recordId);
			const rows = await transaction
				.select()
				.from(table)
				.where(where)
				.limit(2)
				.for("update");
			if (rows.length !== 1) {
				throw new Error("CRDT collection owner is unavailable");
			}
			return {
				kind,
				key,
				table,
				columns,
				where,
				recordId,
				row: rows[0] as Record<string, unknown>,
			};
		},
		async readCanonicalHashes(_transaction, owner, bindings) {
			const result = new Map<string, Uint8Array>();
			for (const binding of bindings) {
				const value = owner.row[binding.sourcePath];
				result.set(
					binding.bindingId,
					await hashCrdtCanonicalValue(
						binding.format === 1 ? "text" : "set",
						value,
					),
				);
			}
			return result;
		},
		async writeCanonical(transaction, owner, values) {
			const prepared = preparedOwnerValues.get(owner);
			preparedOwnerValues.delete(owner);
			const update: Record<string, unknown> = {};
			for (const [field, value] of Object.entries(prepared?.values ?? {})) {
				if (
					!owner.columns[field] ||
					prepared?.crdtPaths.has(field) ||
					["id", "revision", "createdAt", "updatedAt", "deletedAt"].includes(
						field,
					)
				) {
					throw new TypeError(
						`CRDT projection acknowledgement cannot write owner field '${field}'`,
					);
				}
				update[field] = value;
			}
			for (const [sourcePath, value] of values) {
				if (!owner.columns[sourcePath]) {
					throw new Error("CRDT canonical column is unavailable");
				}
				update[sourcePath] = value;
			}
			if (Object.keys(update).length === 0) return;
			owner.row = await mutateCanonicalRow({
				transaction,
				table: owner.table,
				where: owner.where,
				lockedRow: owner.row,
				values: update,
				optimisticConcurrency: true,
				expectedRevision: "internal",
			});
		},
		...(prepareAcknowledgement
			? {
					async prepareAcknowledgement(
						transaction: AnyDrizzleClient<any>,
						owner: LockedOwner,
						input: {
							values: ReadonlyMap<string, string | readonly string[]>;
							changed: ReadonlySet<string>;
							resourceId: string;
							resourceEpochId: string;
							basisCommitSeq: bigint;
							commitSeq: bigint;
						},
					) {
						const contributors = await transaction
							.select({
								commitSeq: questpieCrdtCommitTable.commitSeq,
								sessionId: questpieCrdtCommitTable.sessionId,
								kind: questpieCrdtSubjectTable.kind,
								issuer: questpieCrdtSubjectTable.issuerKey,
								subjectId: questpieCrdtSubjectTable.subjectKey,
							})
							.from(questpieCrdtCommitTable)
							.innerJoin(
								questpieCrdtSubjectTable,
								eq(
									questpieCrdtSubjectTable.id,
									questpieCrdtCommitTable.subjectId,
								),
							)
							.where(
								and(
									eq(questpieCrdtCommitTable.resourceId, input.resourceId),
									eq(
										questpieCrdtCommitTable.resourceEpochId,
										input.resourceEpochId,
									),
									gt(questpieCrdtCommitTable.commitSeq, input.basisCommitSeq),
									lte(questpieCrdtCommitTable.commitSeq, input.commitSeq),
								),
							)
							.orderBy(asc(questpieCrdtCommitTable.commitSeq));
						const result = await prepareAcknowledgement({
							transaction,
							owner: Object.freeze({
								kind: owner.kind,
								key: owner.key,
								recordId: owner.recordId,
								current: Object.freeze({ ...owner.row }),
							}),
							values: new Map(input.values),
							changed: new Set(input.changed),
							contributors: Object.freeze(
								contributors.map((contributor) =>
									Object.freeze({
										commitSeq: contributor.commitSeq,
										sessionId: contributor.sessionId,
										actor:
											contributor.kind === 1
												? Object.freeze({
														kind: "human" as const,
														subjectId: contributor.subjectId,
													})
												: Object.freeze({
														kind: "agent" as const,
														issuer: contributor.issuer,
														subjectId: contributor.subjectId,
													}),
									}),
								),
							),
							resourceId: input.resourceId,
							resourceEpochId: input.resourceEpochId,
							basisCommitSeq: input.basisCommitSeq,
							commitSeq: input.commitSeq,
						});
						if (result?.ownerValues) {
							preparedOwnerValues.set(owner, {
								values: Object.freeze({ ...result.ownerValues }),
								crdtPaths: new Set(input.values.keys()),
							});
						}
						return {
							...(result?.values ? { values: result.values } : {}),
							...(result?.ownerValues ? { ownerChanged: true } : {}),
						};
					},
				}
			: {}),
		async appendRealtimeChange(_transaction, owner, input) {
			const event = await app.realtime.appendChange({
				resourceType: owner.kind,
				resource: owner.key,
				operation: "update",
				recordId: owner.recordId === null ? null : String(owner.recordId),
				payload: { origin: input.origin },
			});
			onAfterCommit(() => app.realtime.notify(event));
			return 1;
		},
	});
}

function decodeCollectionLocator(locator: string): string | number {
	let value: unknown;
	try {
		value = JSON.parse(locator);
	} catch {
		throw new Error("CRDT collection locator is invalid");
	}
	if (
		!Array.isArray(value) ||
		value.length !== 3 ||
		value[0] !== "id" ||
		(value[1] !== "string" && value[1] !== "number") ||
		typeof value[2] !== value[1] ||
		(typeof value[2] === "number" && !Number.isSafeInteger(value[2]))
	) {
		throw new Error("CRDT collection locator is invalid");
	}
	return value[2];
}
