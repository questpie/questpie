import { startStdioServer } from "@questpie/mcp/stdio";
import type { AppContext, RequestContext } from "questpie";

import { app, createContext } from "#questpie";

const ctx = await createContext({ accessMode: "system" });

await startStdioServer(app, {
	accessMode: "system",
	ctx: ctx as AppContext & Partial<RequestContext>,
});
