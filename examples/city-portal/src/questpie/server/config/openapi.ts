import { openApiConfig } from "@questpie/openapi";

export default openApiConfig({
	info: {
		title: "City Portal API",
		version: "1.0.0",
		description: "QUESTPIE API for the City Portal example",
	},
	scalar: { theme: "blue" },
});
