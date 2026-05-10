/**
 * Modules — static module dependencies for this project.
 */
import { adminModule } from "@questpie/admin/modules/admin";
import { auditModule } from "@questpie/admin/modules/audit";
import { openApiModule } from "@questpie/openapi";

export default [
	adminModule,
	auditModule,
	openApiModule,
] as const;
