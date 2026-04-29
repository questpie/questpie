import { openApiConfig } from "@questpie/openapi";

export default openApiConfig({
	info: {
		title: "Barbershop API",
		version: "1.0.0",
		description: "QUESTPIE API for the Barbershop example",
	},
	scalar: { theme: "purple" },
});
