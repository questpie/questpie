import { eq, getTableColumns } from "drizzle-orm";

import { onAfterCommit } from "#questpie/server/collection/crud/shared/transaction.js";
import type { Questpie } from "#questpie/server/config/questpie.js";

import type { CrdtReplaceOwnerPort } from "./replace-store.js";
import {
	questpieCrdtDefinitionTable,
	questpieCrdtResourceTable,
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

export function createQuestpieReplaceOwnerPort(
	app: Questpie<any>,
): CrdtReplaceOwnerPort<LockedOwner> {
	return Object.freeze({
		async lock(transaction, input) {
			const [identity] = await transaction
				.select({
					definitionId: questpieCrdtResourceTable.definitionId,
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
				.where(eq(questpieCrdtResourceTable.id, input.resourceId));
			if (!identity || identity.definitionId !== input.definitionId) {
				throw new Error("CRDT replace owner identity is unavailable");
			}
			const kind = identity.ownerKind === 1 ? "collection" : "global";
			const entries = Object.entries(
				kind === "collection" ? app.collections : app.globals,
			) as [string, any][];
			const ownerEntry = entries.find(
				([, crud]) => crud?.["~internalState"]?.name === identity.ownerKey,
			);
			if (!ownerEntry) throw new Error("CRDT replace owner is not registered");
			const [key, crud] = ownerEntry;
			const table = crud["~internalRelatedTable"];
			const columns = getTableColumns(table) as Record<string, any>;
			if (kind === "global") {
				if (identity.locator !== '["global"]') {
					throw new Error("CRDT replace global locator is invalid");
				}
				const rows = await transaction
					.select()
					.from(table)
					.limit(2)
					.for("update");
				if (rows.length !== 1 || !columns.id) {
					throw new Error("CRDT replace global owner is not singleton");
				}
				return {
					kind,
					key,
					table,
					columns,
					where: eq(columns.id, rows[0]!.id),
					recordId: null,
					row: rows[0] as Record<string, unknown>,
				};
			}
			const recordId = decodeCollectionLocator(identity.locator);
			if (!columns.id) {
				throw new Error("CRDT replace collection has no id column");
			}
			const where = eq(columns.id, recordId);
			const rows = await transaction
				.select()
				.from(table)
				.where(where)
				.limit(2)
				.for("update");
			if (rows.length !== 1) {
				throw new Error("CRDT replace collection owner is unavailable");
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
		async writeCanonical(transaction, owner, values) {
			const update: Record<string, string | readonly string[]> = {};
			for (const [sourcePath, value] of values) {
				if (!owner.columns[sourcePath]) {
					throw new Error("CRDT replace canonical column is unavailable");
				}
				update[sourcePath] = value;
			}
			const [written] = await transaction
				.update(owner.table)
				.set(update)
				.where(owner.where)
				.returning();
			if (!written) throw new Error("CRDT replace canonical write failed");
			owner.row = written as Record<string, unknown>;
		},
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
		throw new Error("CRDT replace collection locator is invalid");
	}
	if (
		!Array.isArray(value) ||
		value.length !== 3 ||
		value[0] !== "id" ||
		(value[1] !== "string" && value[1] !== "number") ||
		typeof value[2] !== value[1] ||
		(typeof value[2] === "number" && !Number.isSafeInteger(value[2]))
	) {
		throw new Error("CRDT replace collection locator is invalid");
	}
	return value[2];
}
