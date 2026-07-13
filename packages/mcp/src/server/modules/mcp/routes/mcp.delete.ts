import { route } from "questpie";

import { mcpHandler, mcpMeta } from "../../../mcp-http.js";

// DELETE = session end. Shares `mcpHandler` on the `mcp` path (see `mcp.ts`).
export default route().delete().raw().meta(mcpMeta).handler(mcpHandler);
