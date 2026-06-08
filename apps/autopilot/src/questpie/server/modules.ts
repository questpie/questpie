import { adminModule } from "@questpie/admin/modules/admin";
import { auditModule } from "@questpie/admin/modules/audit";
import { aiModule } from "@questpie/ai/modules/ai";
import { executorModule } from "@questpie/executor/modules/executor";
import { mcpModule } from "@questpie/mcp";
import { workflowsModule } from "@questpie/workflows/modules/workflows";

export default [
	adminModule,
	auditModule,
	aiModule,
	workflowsModule,
	mcpModule,
	executorModule,
] as const;
