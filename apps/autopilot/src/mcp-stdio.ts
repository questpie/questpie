import type { AppContext, RequestContext } from "questpie";

import { app, createContext } from "#questpie";
import { startStdioServer } from "@questpie/mcp/stdio";

// Stdio MCP is the local worker boundary. It is intentionally system-scoped
// because agent CLIs use it inside a trusted worker process, not over HTTP.
const ctx = await createContext({ accessMode: "system" });

await startStdioServer(app, {
	accessMode: "system",
	ctx: ctx as AppContext & Partial<RequestContext>,
});
