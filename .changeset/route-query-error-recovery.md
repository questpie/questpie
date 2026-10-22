---
"questpie": patch
"@questpie/tanstack-query": patch
---

Keep LIVE route queries subscribed after temporary compute failures so the next dependency change or maximum-age refresh can recover. Treat hidden-resource NOT_FOUND failures like other access denials. Clear only the affected TanStack query's protected snapshot while fresh authority is unavailable, including its cancellation fallback, without interrupting sibling subscriptions.
