---
"questpie": minor
---

Export `routeApp(ctx)` — the helper that resolves the app instance inside a `route().raw()` handler is now part of the public `questpie` API. External modules that register raw transport routes need it to reach the app without a deep import.

This also unblocks serving multiple HTTP methods from one transport endpoint on a single path: since `route()` accepts one method, register the shared handler once per method using `"<path>:<METHOD>"` route keys (the same convention the core CRUD/auth routes use) — e.g. `"mcp:GET"`, `"mcp:POST"`, `"mcp:DELETE"`, `"mcp:OPTIONS"`. This restores loading of apps that register such endpoints (e.g. the MCP module).
