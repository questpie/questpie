---
"@questpie/mcp": minor
---

Breaking behavior change: the previously unbounded MCP tools catalog must now be strictly less than 100,000 UTF-8 bytes, including the complete result wrapper, schemas, and metadata after visibility and schema projection. Oversized catalogs fail explicitly with their largest contributors. No tools or required input/output schemas are silently removed, and pagination cannot bypass the limit. This applies to HTTP, workload, trusted-maintenance stdio discovery, and the in-process workload port’s listCustomTools result.

Migration: measure your complete tools/list response and target less than 85,000 UTF-8 bytes to leave headroom. Reduce verbose descriptions or explicitly configure which tools your release exposes if it exceeds the limit. Set execution.maxCatalogBytes to 85,000 (or a stricter threshold) to enforce that margin; the 100,000-byte ceiling cannot be raised.

Generated CRUD discovery uses cached schema projections with shared references to reduce catalog size. Input schemas preserve optional defaults, including recursive block children. Workload server and in-process port discovery now advertise custom-tool defaults as optional, matching human discovery. Tool tuple schemas remain compatible with the MCP SDK’s default draft-07 validator, including output validation after a client lists tools. Server-side Zod validation, the complete visible tool set, and output schemas remain intact. Principals with zero visible tools receive an empty list and can still use authorized resources and prompts. Schema-diet installation fails closed in every environment if SDK internals prevent budget enforcement, and unsupported tools/list cursors return InvalidParams (-32602).
