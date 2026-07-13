import { route } from "questpie";

import { mcpHandler, mcpMeta } from "../../../mcp-http.js";

// GET = SSE stream. Shares `mcpHandler` on the `mcp` path (see `mcp.ts`).
export default route().get().raw().meta(mcpMeta).handler(mcpHandler);
