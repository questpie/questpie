---
"@questpie/mcp": minor
---

Enforce a hard UTF-8 byte budget below 100,000 bytes on the complete advertised MCP tools catalog, including schemas and metadata after projection. Set execution.maxCatalogBytes to a lower threshold to reserve headroom. An oversized catalog fails explicitly with its largest contributors; tools and output schemas are never silently dropped. This applies to HTTP, workload, and trusted-maintenance stdio discovery. Schema-diet installation failures now fail closed in production so the budget cannot be bypassed.

Generated CRUD tool schemas now preserve Zod's shared definitions as references through SDK discovery, reducing repeated schema bytes while keeping server validation and the complete tool set intact.
