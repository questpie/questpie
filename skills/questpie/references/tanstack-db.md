---
name: questpie-tanstack-db
description:
  QUESTPIE TanStack DB integration - createQuestpieCollections typed client-side collections, useLiveQuery reactive queries, refetch and snapshot sync modes, eq and or gt lt inArray query helpers re-exported from TanStack DB, QuestpieDb collection keys row and select types, optimistic local store backed by the typed client
  - questpie-core
---

## Overview

`@questpie/tanstack-db` turns your typed QUESTPIE client into TanStack DB
collections: a local, queryable store that syncs from the server and updates the
UI reactively. Use it when a screen queries the same data repeatedly and wants
joins or filters evaluated on the client.

It sits beside `@questpie/tanstack-query`, not on top of it. Reach for query
options when you fetch a shape and render it; reach for collections when you keep
a working set in memory and query it many ways.

## Creating the collections

```ts
import { createQuestpieCollections } from "@questpie/tanstack-db";
import { QueryClient } from "@tanstack/react-query";

import { client } from "@/lib/questpie-client";

const queryClient = new QueryClient();

export const db = createQuestpieCollections(client, { queryClient });
```

`db.<collection>` is one collection per collection in your schema, typed from the
same `AppConfig` the client carries. Nothing is registered by hand.

```ts
type CreateQuestpieCollectionsOptions<TApp> = {
	queryClient: QueryClient;
	syncMode?: QuestpieDbSyncMode; // "refetch" (default) | "snapshot"
	find?: QuestpieFindOptions<TApp>; // per-collection find options
	keyPrefix?: QueryKey; // namespace the underlying query keys
};
```

### Sync modes

| Mode                  | Behaviour                                                    |
| --------------------- | ------------------------------------------------------------ |
| `"refetch"` (default) | a change invalidates and refetches the collection            |
| `"snapshot"`          | the server pushes a snapshot and the store replaces its rows |

### Find options are base-row only

A collection needs whole rows with an `id`, so the options that reshape a result
are rejected: `columns`, `with`, `extras` and `groupBy` throw. Filter, order and
page freely; project on the client with `useLiveQuery` instead, or use
`@questpie/tanstack-query` when you want a narrowed shape from the server.

## Querying

```ts
import { eq, useLiveQuery } from "@questpie/tanstack-db";

function PublishedPosts() {
	const { data } = useLiveQuery((q) =>
		q.from({ post: db.posts }).where(({ post }) => eq(post.published, true)),
	);
	return <List items={data} />;
}
```

`useLiveQuery`, `and`, `or`, `eq`, `gt`, `lt` and `inArray` are re-exported from
TanStack DB and TanStack React DB unchanged. They are here so a component imports
from one place; their semantics and their documentation are upstream's. Only
`createQuestpieCollections` is QUESTPIE's own.

Optimistic-concurrency failures are normalized to
`QuestpieDbConflictError`. Catch it when a mutation should refetch stale rows
before offering a retry; its `collection`, `operation`, and `ids` properties
identify the failed atomic batch.

```ts
import { QuestpieDbConflictError } from "@questpie/tanstack-db";

try {
	await db.posts.update(id, (draft) => {
		draft.title = "Canonical title";
	});
} catch (error) {
	if (error instanceof QuestpieDbConflictError) {
		await queryClient.invalidateQueries();
	}
}
```

## Types

`QuestpieDb` is the collection map, and the rest describe one collection:
`QuestpieCollections`, `CollectionKeys`, `CollectionRowOf`, `CollectionSelectOf`,
`CollectionRelationsOf`, `IdOf`, `FindOptionsOf`, plus `QuestpieFindOptions` and
`QuestpieDbSyncMode`. All are inferred from your generated `AppConfig`, so a
schema change is a compile error rather than a runtime surprise.
