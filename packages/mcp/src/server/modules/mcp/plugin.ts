/**
 * MCP module plugin — re-exports the MCP codegen plugin so that module
 * codegen discovers it and embeds it in the generated module definition.
 * This allows `extractPluginsFromModules` to pick it up automatically at
 * root-app codegen time (so consuming apps get the `mcp-tools` category,
 * `config/mcp.ts` discover, and scaffolds).
 */
import { mcpPlugin } from "../../plugin.js";

export default mcpPlugin();
