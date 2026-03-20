/**
 * Modules — static module dependencies for this project.
 * These are the pre-built modules the barbershop app uses.
 */
import { adminModule, auditModule } from "@questpie/admin/server";
import { openApiModule } from "@questpie/openapi";

export default [
	adminModule,
	auditModule,
	openApiModule,
] as const;
