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

Read the current snapshot from the resource:

<!-- packed-example: query-resource -->

```ts
const resource = api.queries["tickets.detail"].observe({ id: ticketId });
const snapshot = resource.getSnapshot();
```

Each Context scope retains at most 128 Query Resource identities and evicts
only idle least-recently-used entries. Terminal failure requires a fresh
observation. Query Resources add neither polling fallback nor automatic Mutation
invalidation. This framework-neutral contract remains available for non-React
consumers.

## Use native React Query

Read [the native screen guide](https://questpie.com/docs/v4/react-query-basic)
before building a React consumer; use its generated options and credential-owned
mount/cleanup pattern. Read [native React Query](https://questpie.com/docs/v4/react-query)
for the adapter's exact lifetime and invalidation contract. Confirm the installed package
exposes `questpie/react-query` and its generated scope supports the adapter
before applying that guidance. This reference does not establish production
availability in an installed package.

Bind the generated Context scope to a host-owned native QueryClient with
`createQueryAdapter(scope, queryClient)` from `questpie/react-query`.
Use each Query's `options(input)` with native Query and Suspense hooks, and each
Mutation's `options()` with native Mutation hooks. Only compiler-proven root forward-cursor
Queries offer `infiniteOptions(input)`; infinite pages are one-shot, not live
page unions. Keep DTOs, keys, codecs and continuation rules generated, and narrow
declared errors through the operation's `isError` predicate.

Choose one state owner for a displayed result. The native adapter uses the
generated watch directly with TanStack's cache; do not feed a Query Resource
into that cache. A credential or Context change requires a fresh scope,
retirement of the old adapter and removal of the old credential subtree.
Disposal fences retained options and attached state, not copies already held
by application code or callbacks already running.

Keep generated transport, identity, continuation and retry defaults intact.
Known local commits conservatively invalidate non-live Query families in the
same binding; ordinary browser-live families use their existing watches.
Refresh failure does not undo a commit, and Mutations do not retry automatically.
Render application-owned Pending Intent alongside the current successful
authorized result; hide it when that result fails or disappears. Never restore
a saved whole cache after a Mutation error.

For SSR, create a request-local QueryClient and use finite calls. TanStack Start's
official Router Query integration owns serialization and hydration; the
adapter's `dehydrate()` returns only its Query Identity Bootstrap. Follow the
[Start guide](https://questpie.com/docs/v4/react-query-start)'s first-document readiness and retirement rules before enabling fresh
browser execution. Framework optimistic layers, TanStack DB and causal
commit-to-observation guarantees are outside this interface.

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
