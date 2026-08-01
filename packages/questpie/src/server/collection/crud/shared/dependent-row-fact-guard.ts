import { inArray, sql } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

import type { DependentRowLockRequest } from "#questpie/server/collection/builder/types.js";
import type { CRUD } from "#questpie/server/collection/crud/types.js";
import { ApiError } from "#questpie/server/errors/index.js";

import {
	compareLockParts,
	lockPartsKey,
	lockValueParts,
} from "./deterministic-lock-order.js";
import { getColumn } from "./field-resolver.js";

const MAX_DEPENDENT_ROW_LOCKS = 100;

type CollectionServer = Pick<CRUD, "~internalRelatedTable">;

type DependentRowTransaction = {
	select: (selection: { id: unknown }) => {
		from: (table: PgTable) => {
			where: (condition: unknown) => {
				orderBy: (order: unknown) => {
					for: (strength: "update") => Promise<unknown>;
				};
			};
		};
	};
};

type PhysicalRequestGroup = {
	orderParts: readonly string[];
	table: PgTable;
	ids: Set<string | number>;
};

/** Claim one globally ordered dependent-row plan before any guard runs. */
export async function lockDependentRows(input: {
	collections: Record<string, CollectionServer>;
	tx: DependentRowTransaction;
	requests: readonly DependentRowLockRequest[];
}): Promise<void> {
	if (!Array.isArray(input.requests)) {
		throw ApiError.badRequest("beforeWrite locks must return an array");
	}

	const grouped = new Map<string, PhysicalRequestGroup>();
	for (const request of input.requests) {
		if (!request || typeof request.collection !== "string") {
			throw ApiError.badRequest("beforeWrite locks require a collection name");
		}
		const collection = input.collections[request.collection];
		if (!collection) {
			throw ApiError.badRequest(
				`Unknown dependent collection "${request.collection}"`,
			);
		}
		if (!Array.isArray(request.ids)) {
			throw ApiError.badRequest("Dependent row ids must be an array");
		}
		const table = collection["~internalRelatedTable"] as PgTable | undefined;
		if (!table) {
			throw ApiError.badRequest(
				`Collection "${request.collection}" cannot lock dependent rows`,
			);
		}
		const idColumn = getColumn(table, "id")!;
		const tableConfig = getTableConfig(table);
		const orderParts = [
			tableConfig.schema ?? "public",
			tableConfig.name,
			String((idColumn as { name?: unknown }).name ?? "id"),
		];
		const physicalKey = lockPartsKey(orderParts);
		const group = grouped.get(physicalKey) ?? {
			orderParts,
			table,
			ids: new Set<string | number>(),
		};
		for (const id of request.ids) group.ids.add(id);
		grouped.set(physicalKey, group);
	}

	const totalIds = [...grouped.values()].reduce(
		(total, group) => total + group.ids.size,
		0,
	);
	if (totalIds > MAX_DEPENDENT_ROW_LOCKS) {
		throw ApiError.badRequest(
			`beforeWrite accepts at most ${MAX_DEPENDENT_ROW_LOCKS} unique dependent ids`,
		);
	}

	const orderedGroups = [...grouped.values()].sort((left, right) =>
		compareLockParts(left.orderParts, right.orderParts),
	);
	for (const group of orderedGroups) {
		const ids = [...group.ids].sort((left, right) =>
			compareLockParts(lockValueParts(left), lockValueParts(right)),
		);
		if (ids.length === 0) continue;
		const idColumn = getColumn(group.table, "id")!;
		const cases = ids.map(
			(id, index) => sql`WHEN ${idColumn} = ${id} THEN ${index}`,
		);
		await input.tx
			.select({ id: idColumn })
			.from(group.table)
			.where(inArray(idColumn, ids))
			.orderBy(sql`CASE ${sql.join(cases, sql.raw(" "))} END`)
			.for("update");
	}
}
