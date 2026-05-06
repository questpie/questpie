import { openApiConfig } from "@questpie/openapi";

export default openApiConfig({
	info: {
		title: "toy-factory-backend API",
		version: "1.0.0",
		description: "QUESTPIE API",
	},
	scalar: { theme: "purple" },
});
