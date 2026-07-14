---
"questpie": minor
"@questpie/admin": patch
"@questpie/tanstack-query": minor
"@questpie/workflows": minor
---

Ship Realtime v2 and typed application channels as one transport-agnostic realtime system.

- Add transaction-bound realtime capture, durable reconciliation, resumable live-query topics, per-session refresh sharing, snapshot suppression, admission and backpressure limits, structured observations, and hardened pg-notify, Redis, and Cloudflare broker paths.
- Add file-convention `channel()` definitions, generated server and client types, per-verb subscribe/publish authorization, Zod-validated events, ordered replay with explicit gap handling, and typed TanStack Query channel subscriptions.
- Add transport-independent live presence with `subscribePresence()`, `presenceIter()`, and TanStack latest-roster queries; SSE uses cross-instance Postgres leases with principal aggregation and crash expiry, while Pusher/Soketi uses native provider membership behind the same client API.
- Add the zero-infrastructure SSE preset and the optional Pusher/Soketi preset without changing consumer APIs, plus dynamic auth headers across data, upload, SSE, and WebSocket requests.
- Add compatibility rollout modes, operational limits, migration and rollback documentation, reactive React performance guidance, cross-driver integration coverage, and existing admin/workflow consumer regression coverage.

Migration note: bulk update and bulk delete now produce one logical realtime event per operation instead of one event per affected record. Adapter consumers must handle `bulk_update` and `bulk_delete` and use `payload.count` plus `payload.recordIds`. Follow the Realtime v2 migration guide for canary, dual-run, schema migration, and config-only rollback steps.
