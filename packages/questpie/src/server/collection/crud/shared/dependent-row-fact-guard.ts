import { Buffer } from "node:buffer";

import { eq, getTableUniqueName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import type {
	DependentRowLockRequest,
	DependentRowLockResult,
} from "#questpie/server/collection/builder/types.js";
import type {
	CRUD,
	CRUDContext,
} from "#questpie/server/collection/crud/types.js";
import { ApiError } from "#questpie/server/errors/index.js";

import { getColumn } from "./field-resolver.js";

const MAX_DEPENDENT_ROW_LOCKS = 100;

type CollectionServer = Pick<
	CRUD,
	"lockMany" | "~internalRelatedTable" | "~internalReadCanonicalRows"
>;

type DependentRowTransaction = {
	select: (selection: { id: unknown }) => {
		from: (table: PgTable) => {
			where: (condition: unknown) => {
				for: (strength: "update") => Promise<Array<{ id: string | number }>>;
			};
		};
	};
};

type DependentRowLockerInput = {
	collections: Record<string, CollectionServer>;
	context: CRUDContext;
	tx: DependentRowTransaction;
};

const compareUtf8 = (left: string, right: string) =>
	Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));

const idLockKey = (id: string | number) => `${typeof id}:${String(id)}`;

type LogicalRequestGroup = {
	ids: Set<string | number>;
	includeDeleted: boolean;
	lockedIds: (string | number)[];
};

type PhysicalRequestGroup = {
	orderKey: string;
	table: PgTable;
	ids: Set<string | number>;
	existingIds: Set<string>;
	logical: Map<DependentRowLockRequest["collection"], LogicalRequestGroup>;
};

/**
 * Build the single-use dependent-row claim helper for one beforeWrite chain.
 * Physical table identity and type-tagged ids, never caller array order, define
 * the lock sequence shared by every generated mutation.
 */
export function createDependentRowLocker(input: DependentRowLockerInput) {
	let requested = false;

	return async (
		requests: readonly DependentRowLockRequest[],
	): Promise<readonly DependentRowLockResult[]> => {
		if (requested) {
			throw ApiError.badRequest(
				"lockDependentRows accepts one request set per beforeWrite hook chain",
			);
		}
		requested = true;
		if (!Array.isArray(requests)) {
			throw ApiError.badRequest("lockDependentRows requires an array");
		}

		const grouped = new Map<string, PhysicalRequestGroup>();
		for (const request of requests) {
			if (!request || typeof request.collection !== "string") {
				throw ApiError.badRequest(
					"lockDependentRows requires a collection name",
				);
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
			const physicalLockKey = `${getTableUniqueName(table)}\0${String(
				(idColumn as { name?: unknown }).name ?? "id",
			)}`;
			const group = grouped.get(physicalLockKey) ?? {
				orderKey: physicalLockKey,
				table,
				ids: new Set<string | number>(),
				existingIds: new Set<string>(),
				logical: new Map(),
			};
			const logical = group.logical.get(request.collection) ?? {
				ids: new Set<string | number>(),
				includeDeleted: false,
				lockedIds: [],
			};
			for (const id of request.ids) {
				group.ids.add(id);
				logical.ids.add(id);
			}
			logical.includeDeleted ||= request.includeDeleted === true;
			group.logical.set(request.collection, logical);
			grouped.set(physicalLockKey, group);
		}

		const totalIds = [...grouped.values()].reduce(
			(total, group) => total + group.ids.size,
			0,
		);
		if (totalIds > MAX_DEPENDENT_ROW_LOCKS) {
			throw ApiError.badRequest(
				`lockDependentRows accepts at most ${MAX_DEPENDENT_ROW_LOCKS} unique ids`,
			);
		}

		const ordered = [...grouped.values()].sort((left, right) =>
			compareUtf8(left.orderKey, right.orderKey),
		);
		const results: DependentRowLockResult[] = [];

		// Claim physical rows independently of logical access. The hook is trusted
		// server configuration, the request is bounded, and existence never leaves
		// this helper. This is what guarantees a wait before access is re-evaluated.
		for (const group of ordered) {
			const ids = [...group.ids].sort((left, right) =>
				compareUtf8(idLockKey(left), idLockKey(right)),
			);
			for (const id of ids) {
				const idColumn = getColumn(group.table, "id")!;
				const physicalRows: Array<{ id: string | number }> = await input.tx
					.select({ id: idColumn })
					.from(group.table)
					.where(eq(idColumn, id))
					.for("update");
				if (physicalRows.length === 1) {
					group.existingIds.add(idLockKey(physicalRows[0]!.id));
				}
			}
		}

		// Only after every physical wait has settled, evaluate each logical alias's
		// current access policy. Missing, fully denied, and row-denied all map to an
		// absent id in the public result.
		for (const group of ordered) {
			const logicalGroups = [...group.logical.entries()].sort((left, right) =>
				compareUtf8(left[0], right[0]),
			);
			for (const [collectionName, logical] of logicalGroups) {
				const collection = input.collections[collectionName]!;
				const ids = [...logical.ids].sort((left, right) =>
					compareUtf8(idLockKey(left), idLockKey(right)),
				);
				for (const id of ids) {
					try {
						const authorized = await collection.lockMany(
							{ ids: [id], includeDeleted: logical.includeDeleted },
							{ ...input.context, db: input.tx },
						);
						if (
							group.existingIds.has(idLockKey(id)) &&
							authorized.length === 1
						) {
							logical.lockedIds.push(authorized[0]!);
						}
					} catch (error) {
						if (!(error instanceof ApiError) || error.getHTTPStatus() !== 403) {
							throw error;
						}
					}
				}
			}

			for (const [collectionName, logical] of logicalGroups) {
				const readCanonicalRows =
					input.collections[collectionName]!["~internalReadCanonicalRows"];
				if (!readCanonicalRows) {
					throw ApiError.badRequest(
						`Collection "${collectionName}" cannot read canonical dependent rows`,
					);
				}
				const rows = await readCanonicalRows(logical.lockedIds, {
					...input.context,
					db: input.tx,
				});
				results.push({
					collection: collectionName,
					lockedIds: logical.lockedIds,
					rows,
				});
			}
		}

		return results;
	};
}
