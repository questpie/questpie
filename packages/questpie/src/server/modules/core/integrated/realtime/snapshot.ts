import { PRECHECKED_READ_ACCESS } from "#questpie/server/collection/crud/shared/access-control.js";

type CollectionFindSnapshotCrud = {
	find(options: Record<string, unknown>, context: unknown): Promise<unknown>;
};

type CollectionCountSnapshotCrud = {
	count(options: Record<string, unknown>, context: unknown): Promise<number>;
};

type CollectionGetSnapshotCrud = {
	findOne(options: Record<string, unknown>, context: unknown): Promise<unknown>;
};

type GlobalSnapshotCrud = {
	get(options: Record<string, unknown>, context: unknown): Promise<unknown>;
};

export type SnapshotQuery = {
	accessWhere?: true | Record<string, unknown>;
	where?: Record<string, unknown>;
	with?: Record<string, unknown>;
	columns?: Record<string, boolean>;
	limit?: number;
	offset?: number;
	orderBy?: Record<string, "asc" | "desc">;
	locale?: string;
};

export type RealtimeSnapshotTopic =
	| (SnapshotQuery & {
			type: "collection";
			operation: "find";
			crud: CollectionFindSnapshotCrud;
	  })
	| (Pick<SnapshotQuery, "accessWhere" | "where" | "locale"> & {
			type: "collection";
			operation: "count";
			crud: CollectionCountSnapshotCrud;
	  })
	| (Pick<SnapshotQuery, "accessWhere" | "with" | "columns" | "locale"> & {
			type: "collection";
			operation: "get";
			recordId: string;
			crud: CollectionGetSnapshotCrud;
	  })
	| (SnapshotQuery & {
			type: "global";
			operation: "get";
			crud: GlobalSnapshotCrud;
	  });

/** Compute one authorized snapshot without knowing how its bytes are delivered. */
export function computeRealtimeSnapshot(
	topic: RealtimeSnapshotTopic,
	context: unknown,
): Promise<unknown> {
	if (topic.type === "collection") {
		if (topic.operation === "count") {
			return topic.crud.count(
				{
					[PRECHECKED_READ_ACCESS]: topic.accessWhere,
					where: topic.where,
					locale: topic.locale,
				},
				context,
			);
		}

		if (topic.operation === "get") {
			return topic.crud.findOne(
				{
					[PRECHECKED_READ_ACCESS]: topic.accessWhere,
					where: { id: topic.recordId },
					with: topic.with,
					columns: topic.columns,
					locale: topic.locale,
				},
				context,
			);
		}

		return topic.crud.find(
			{
				[PRECHECKED_READ_ACCESS]: topic.accessWhere,
				where: topic.where,
				with: topic.with,
				columns: topic.columns,
				limit: topic.limit,
				offset: topic.offset,
				orderBy: topic.orderBy,
				locale: topic.locale,
			},
			context,
		);
	}

	return topic.crud.get(
		{
			[PRECHECKED_READ_ACCESS]: topic.accessWhere,
			where: topic.where,
			with: topic.with,
			columns: topic.columns,
			locale: topic.locale,
		},
		context,
	);
}

type RealtimeHydrateTopic = Omit<
	Extract<RealtimeSnapshotTopic, { type: "collection"; operation: "find" }>,
	"crud"
> & {
	crud: CollectionFindSnapshotCrud & CollectionGetSnapshotCrud;
};

export function mergeRealtimeWhere(
	left: Record<string, unknown> | undefined,
	right: Record<string, unknown>,
): Record<string, unknown> {
	return left ? { AND: [left, right] } : right;
}

/** Hydrate one authoritative row in the topic's projection and locale. */
export function hydrateRealtimeRow(
	topic: RealtimeHydrateTopic,
	recordId: string,
	context: unknown,
): Promise<unknown> {
	return topic.crud.findOne(
		{
			[PRECHECKED_READ_ACCESS]: topic.accessWhere,
			where: mergeRealtimeWhere(topic.where, { id: recordId }),
			columns: topic.columns,
			...(topic.with === undefined ? {} : { with: topic.with }),
			locale: topic.locale,
		},
		context,
	);
}
