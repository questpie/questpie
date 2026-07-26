---
"questpie": minor
"@questpie/openapi": minor
---

Make built-in Search authorization fail closed and capability reporting truthful. Search now requires explicit `.searchable(...)` opt-in, uses one canonical authorized source-row universe for hits, totals, facets, statistics, browse, and semantic ranking, rejects unimplemented hybrid mode, and fails the HTTP response when hydration no longer matches ranked candidates. The default projection is title-only, and hydrated HTTP/client results expose only the relevance score instead of index snapshots that could bypass field access.
