/**
 * Modules — static module dependencies for this project.
 */
import { adminModule } from "@questpie/admin/server";
import { openApiModule } from "@questpie/openapi";

export default [
	adminModule,
	openApiModule({
		info: {
			title: "{{projectName}} API",
			version: "1.0.0",
			description: "QUESTPIE API",
		},
		scalar: { theme: "purple" },
	}),
] as const;
