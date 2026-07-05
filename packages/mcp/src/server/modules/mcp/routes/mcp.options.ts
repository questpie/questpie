import { route } from "questpie";

import { mcpHandler, mcpMeta } from "../../../mcp-http.js";

// OPTIONS = CORS preflight. Shares `mcpHandler` on the `mcp` path (see `mcp.ts`).
export default route().options().raw().meta(mcpMeta).handler(mcpHandler);
