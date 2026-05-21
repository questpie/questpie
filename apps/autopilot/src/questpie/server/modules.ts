import { adminModule } from "@questpie/admin/modules/admin";
import { auditModule } from "@questpie/admin/modules/audit";
import { aiModule } from "@questpie/ai/modules/ai";
import { mcpModule } from "@questpie/mcp";
import { workflowsModule } from "@questpie/workflows/modules/workflows";

// @ts-expect-error workflowsModule currently exposes a circular generated type.
export default [
	adminModule,
	auditModule,
	aiModule,
	workflowsModule,
	mcpModule,
] as const;
