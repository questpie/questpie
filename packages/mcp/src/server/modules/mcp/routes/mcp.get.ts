import { route } from "questpie";

import { mcpHandler, mcpMeta } from "../../../mcp-http.js";

// Stateless mode has no SSE session lifecycle; GET returns 405.
export default route()
	.get()
	.raw()
	.access(true)
	.meta(mcpMeta)
	.handler(mcpHandler);
