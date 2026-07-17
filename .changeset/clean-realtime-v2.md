---
"questpie": major
"create-questpie": major
---

Remove the deprecated realtime compatibility layer and make Realtime v2 the only supported contract.

- Remove `RealtimeAdapter`, `realtime.adapter`, `realtime.rollout`, the `legacy` and `dual` modes, and the old Postgres, Redis Streams, and Cloudflare realtime adapter entrypoints.
- Remove delta control frames and client downgrade behavior. Companion control now requires complete desired topology protocol v1.
- Keep `ChangeBroker`, the distributed topology coordinator, structured non-retryable admission errors, and the default `maxFindLimit` of 100 as the supported framework path.

Upgrade all QuestPie realtime clients and servers together across this major boundary. Postgres apps continue to receive the automatic `PgNotifyChangeBroker`; Redis deployments should configure `redisStreamsChangeBroker`.
