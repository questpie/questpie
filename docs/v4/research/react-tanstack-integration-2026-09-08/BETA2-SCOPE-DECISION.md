# Beta.2 optimism scope decision

Owner-confirmed release planning, 2026-09-08. This changes the construction
scope, not Accepted product authority or the release verdict. The owner
confirmed the focused grill's recommendation with “Ok”.

Beta.2 keeps native TanStack Query integration, generated types and keys,
Suspense, forward infinite Queries, Start SSR/hydration, safe scope lifetime,
truthful Mutation outcomes and conservative inferred invalidation.

Optimistic intent stays in application code using native TanStack Mutation
options and state. Ship an executable typed recipe, not a new optimistic DSL
or framework-owned cache. Authors do not repeat Operation DTOs or cache keys.
The preferred simple recipe renders pending input separately from the current
authorized Query result. It must demonstrate its lifetime and error limits;
it is not a claim that arbitrary application cache writes are safe.

The following are not beta.2 blockers:

- a framework-owned ordered optimistic-layer engine;
- automatic rollback/rebase across overlapping application edits; and
- a no-flicker or causal commit-to-observed-snapshot guarantee, including a new
  observation receipt or forced fresh-watch fence built for that guarantee.

This is a deliberate deferral, not evidence those features are impossible.
Native callbacks, generated options and the existing watch remain their future
integration seams. A future consumer may pull a focused decision with concrete
concurrency/authority evidence; no dormant compatibility implementation ships.

Inferred invalidation remains required and independent of optimistic layers.
It must not duplicate active live recomputation with blanket HTTP refreshes,
claim atomic delivery across Query views, expose private dependency facts or
treat successful invalidation scheduling as proof that a view observed commit.
Existing Mutation outcome and retry semantics remain unchanged.

Do not recommend restoring a saved whole Query cache after any Mutation error:
that can overwrite another successful edit or restore a row/Field omitted by a
newer authorized snapshot. Unknown outcomes and known post-commit failures are
not rollback evidence. Application-held copies and already-running callbacks
cannot be erased by disposing the adapter.

Production extraction, the focused superseding React decision, consumer/docs/
skill migration and all final release gates remain required. No publish, tag,
deprecation or registry change is authorized by this scope decision.
