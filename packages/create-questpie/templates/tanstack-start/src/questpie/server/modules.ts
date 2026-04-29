/**
 * Modules — static module dependencies for this project.
 */
import { adminModule } from "@questpie/admin/server";
import { openApiModule } from "@questpie/openapi";

export default [
	adminModule,
	openApiModule,
] as const;
