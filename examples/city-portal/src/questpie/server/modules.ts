/**
 * Modules — static module dependencies for this project.
 */
import { adminModule, auditModule } from "@questpie/admin/server";
import { openApiModule } from "@questpie/openapi";

export default [
	adminModule,
	auditModule,
	openApiModule,
] as const;
