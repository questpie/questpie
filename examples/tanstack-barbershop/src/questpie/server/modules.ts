/**
 * Modules — static module dependencies for this project.
 * These are the pre-built modules the barbershop app uses.
 */
import { adminModule } from "@questpie/admin/modules/admin";
import { auditModule } from "@questpie/admin/modules/audit";
import mcpModule from "@questpie/mcp";
import { openApiModule } from "@questpie/openapi";

export default [
	adminModule,
	auditModule,
	mcpModule,
	openApiModule,
] as const;
