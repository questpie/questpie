import { route } from "questpie";

import { mcpHandler, mcpMeta } from "../../../mcp-http.js";

// Stateless mode has no session to delete; DELETE returns 405.
export default route()
	.delete()
	.raw()
	.access(true)
	.meta(mcpMeta)
	.handler(mcpHandler);
