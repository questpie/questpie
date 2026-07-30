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

					// SORTED, not insertion order. The category map is filled in
					// directory-read order, which differs between machines — this
					// emitted the same union in a different sequence on macOS and on
					// CI's Linux runner, so committed `.generated` output could never
					// match a fresh generation there. Generating twice on one machine
					// does not catch it; both runs see the same readdir order.
					const keys = [...routes.keys()].sort();
					const union = keys.map((k) => `"${k}"`).join(" | ");
					ctx.addTypeDeclaration(`export type AppRouteKeys = ${union};`);
				},
			},
		},
	};
}
