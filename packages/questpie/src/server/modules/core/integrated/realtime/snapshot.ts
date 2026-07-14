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

type SnapshotQuery = {
	accessWhere?: true | Record<string, unknown>;
	where?: Record<string, unknown>;
	with?: Record<string, unknown>;
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
	| (Pick<SnapshotQuery, "accessWhere" | "with" | "locale"> & {
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
			locale: topic.locale,
		},
		context,
	);
}
