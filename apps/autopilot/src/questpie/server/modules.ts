import { adminModule } from "@questpie/admin/modules/admin";
import { auditModule } from "@questpie/admin/modules/audit";
import { mcpModule } from "@questpie/mcp";
import { workflowsModule } from "@questpie/workflows/modules/workflows";

export default [adminModule, auditModule, workflowsModule, mcpModule] as const;
