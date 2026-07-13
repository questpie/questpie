---
"questpie": patch
---

Harden Cloudflare realtime by sharding Durable Objects per resource, broadcasting notice-only payloads off the mutation path, and keeping snapshot queries in the requesting Worker.
