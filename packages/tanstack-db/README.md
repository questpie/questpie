# @questpie/tanstack-db

Typed TanStack DB collections backed by a QUESTPIE client.

## Per-request setup

TanStack Start and other SSR applications must create both the QueryClient and
the QUESTPIE collections once per request:

```ts
import { createQuestpieCollections } from "@questpie/tanstack-db";
import { QueryClient } from "@tanstack/react-query";
import type { QuestpieClient } from "questpie/client";

import type { AppConfig } from "#questpie";

export function createRequestDb(client: QuestpieClient<AppConfig>) {
	const queryClient = new QueryClient();
	const db = createQuestpieCollections(client, { queryClient });

	return { db, queryClient };
}
```

Call `db.destroy()` when the request or browser application is torn down. A
module-scope registry is safe only in the browser; on the server it would leak
one request's optimistic overlay into another request.

Use `syncMode: "snapshot"` to keep the store replaced from QUESTPIE `.live()`
snapshots. The default is `"refetch"` and uses TanStack Query's authoritative
refetch after a successful mutation. Successful optimistic mutations are folded
into the current authoritative snapshot until the next live snapshot arrives.

The `find` registry option accepts only row-shape-preserving filters, ordering,
pagination, locale, stage, and soft-delete controls. Projections (`columns`),
relation expansion (`with`), extras, and grouping are rejected because every
TanStack DB row must retain the base collection shape and its canonical `id`.

The package currently supports refetch and full-snapshot synchronization. Native
row-delta synchronization is added independently without changing the collection
factory API.
