/**
 * Modules — static module dependencies for this project.
 */
import { adminModule, auditModule } from "@questpie/admin/server";
import { openApiModule } from "@questpie/openapi";

export default [
	adminModule,
	auditModule,
	openApiModule({
		info: {
			title: "City Portal API",
			version: "1.0.0",
			description: "QUESTPIE API for the City Portal example",
		},
		scalar: { theme: "blue" },
	}),
] as const;
