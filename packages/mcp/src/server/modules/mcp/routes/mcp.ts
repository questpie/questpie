import { route } from "questpie";

import { mcpHandler, mcpMeta } from "../../../mcp-http.js";

// POST = JSON-RPC messages. GET/DELETE/OPTIONS live in the sibling
// method-suffixed files (`mcp.get.ts` / `mcp.delete.ts` / `mcp.options.ts`),
// all sharing `mcpHandler` on the same `mcp` path.
export default route().post().raw().meta(mcpMeta).handler(mcpHandler);
