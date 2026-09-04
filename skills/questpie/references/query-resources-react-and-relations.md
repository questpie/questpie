# Reactive queries and Relations

Read [data and structural Queries](https://questpie.com/docs/v4/data-and-queries)
and [reactive Query state](https://questpie.com/docs/v4/reactive-query-resources)
before changing selection or client observation.

## Traverse declared Relations

Build selections from generated Collection and Relation values. Use the single
inverse child-list form `children.list({ first, orderBy, select })`; keep root
Query pagination in its separate `page` or input grammar. Apply Policy before
ordering and limits.

A watchable Query may contain at most one inverse child list and four Relation
edges in total. Inverse `first` is required and bounded from 1 through 50; root
pages are bounded at 100. One result may materialize at most 5,050 root/child
positions and one encoded result is bounded at 1 MiB. Prefer a smaller
purpose-built composite Query when those bounds do not fit the screen.

## Observe generated Query state

Only compiler-proven watchable generated Queries expose `.observe(input)`.
Create one immutable `client.withContext(context)` scope, then observe from
that scope. The first subscriber starts the Live Query and the last subscriber
stops it. Recomputes replace the complete result; rollback and unsuccessful
recompute publish nothing.

Each Context scope retains at most 128 Query Resource identities and evicts
only idle least-recently-used entries. Terminal failure requires a fresh
observation. There is no polling fallback or automatic Mutation invalidation.

For React 19, import only the adapter hook:

<!-- packed-example: react-query-resource -->

```tsx
import { useQueryResource } from "questpie/react";

const resource = api.queries["tickets.detail"].observe({ id: ticketId });
const snapshot = useQueryResource(resource);
```

Render the closed `pending`, `ready`, and `failed` states. The adapter owns no
cache, transport, retry, Context, provider, SSR, Suspense, or hydration.

## Model heterogeneous values in TypeScript

Import `DiscriminatedValue`, `DiscriminatedReference`, and
`matchDiscriminated` from `questpie` when the application needs an exhaustive
ordinary TypeScript union. Validate untrusted data with its boundary codec
before matching.

Keep each target's branded ID type while making every case explicit:

<!-- packed-example: discriminated-reference -->

```ts
import { type DiscriminatedReference, matchDiscriminated } from "questpie";

declare const ticketIdBrand: unique symbol;
declare const commentIdBrand: unique symbol;
type TicketId = string & { readonly [ticketIdBrand]: true };
type CommentId = string & { readonly [commentIdBrand]: true };

type Subject = DiscriminatedReference<{
	ticket: TicketId;
	comment: CommentId;
}>;

export function subjectKey(subject: Subject): string {
	return matchDiscriminated(subject, {
		ticket: ({ id }) => `ticket:${id}`,
		comment: ({ id }) => `comment:${id}`,
	});
}
```

These helpers add no codec, Field, foreign key, inverse, join, Policy traversal,
Live dependency, or polymorphic Relation. Resolve referenced rows through an
explicit Query or Mutation so current Policy controls disclosure.
