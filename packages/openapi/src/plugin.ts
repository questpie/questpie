/**
 * OpenAPI Codegen Plugin
 *
 * Lightweight plugin that:
 * 1. Emits an `AppRouteKeys` type from discovered routes
 * 2. Discovers `config/openapi.ts` for typed OpenAPI configuration
 *
 * @example
 * ```ts
 * // questpie.config.ts
 * import { openApiPlugin } from "@questpie/openapi/plugin";
 *
 * export default runtimeConfig({
 *   plugins: [openApiPlugin()],
 * });
 * ```
 */

import type { CodegenPlugin } from "questpie";

export function openApiPlugin(): CodegenPlugin {
	return {
		name: "questpie-openapi",
		targets: {
			server: {
				root: ".",
				outputFile: "index.ts",
				discover: {
					openapi: { pattern: "config/openapi.ts", configKey: "openapi" },
				},
				registries: {
					singletonFactories: {
						openapi: {
							configType: "OpenApiModuleConfig",
							imports: [
								{
									name: "OpenApiModuleConfig",
									from: "@questpie/openapi",
								},
							],
						},
					},
				},
				transform: (ctx) => {
					const routes = ctx.categories.get("routes");
					if (!routes?.size) return;

					const keys = [...routes.keys()];
					const union = keys.map((k) => `"${k}"`).join(" | ");
					ctx.addTypeDeclaration(`export type AppRouteKeys = ${union};`);
				},
			},
		},
	};
}
