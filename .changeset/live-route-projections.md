---
"questpie": minor
"@questpie/tanstack-query": minor
---

Explicit query({ live }) routes can stream complete authorized projections over the existing shared SSE connection. Declare data and authority dependencies on captured collections with optional scalar equality anchors. Evaluations refresh identity and request-derived context facts, run access and data in one read-only repeatable-read snapshot, and capture the visibility watermark inside it. Authority events discard in-flight and queued results; maximum-age refresh and existing outbox reconciliation cover expiry and missed notifications. This is bounded reauthorization, not a linearizable revocation fence.

Typed route method callers gain watch(input, { signal, params, locale }) only for explicitly LIVE definitions. HTTP calls accept the same path params and locale options. Wire input types remain distinct from parsed handler input, and Date snapshots retain their typed encoding. The TanStack factory adds query(input, { realtime: true }) on these routes; the initial value comes from SSE, snapshots replace data, and access denial clears only that watch's cached data. Ordinary routes remain non-realtime. Route LIVE requires native SSE; collection delta delivery remains unchanged.

Once a transaction is acquired, its LIVE evaluation callback has a 30-second deadline and PostgreSQL statements have a 30-second timeout. Queueing, identity refresh, pool acquisition and cleanup can add time; application JavaScript must honor request.signal. Read query guidance for dependency coverage, context/transaction ownership, bounded relation loading, authorization batching, indexing and SQL-growth tests before adopting LIVE projections. No database migration is required.
