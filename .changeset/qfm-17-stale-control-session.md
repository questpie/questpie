---
"questpie": patch
---

Keep realtime control requests bound to their SSE session. Skip topology submissions after teardown and ignore late responses from an old session so they cannot abort or notify a replacement connection. New sessions flush independently of pending old control requests.
