/**
 * Modules — static module dependencies for this project.
 * These are the pre-built modules the barbershop app uses.
 */
import { adminModule, auditModule } from "@questpie/admin/server";
import { openApiModule } from "@questpie/openapi";

export default [
	adminModule,
	auditModule,
	openApiModule({
		info: {
			title: "Barbershop API",
			version: "1.0.0",
			description: "QUESTPIE API for the Barbershop example",
		},
		scalar: { theme: "purple" },
	}),
] as const;
