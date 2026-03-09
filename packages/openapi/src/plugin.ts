/**
 * OpenAPI Codegen Plugin
 *
 * Lightweight plugin that emits an `AppRouteKeys` type from discovered routes.
 * Enables static analysis and type-safe route references without runtime execution.
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
				transform: (ctx) => {
					const routes = ctx.categories.get("routes");
					if (!routes?.size) return;

					const keys = [...routes.keys()];
					const union = keys.map((k) => `"${k}"`).join(" | ");
					ctx.addTypeDeclaration(
						`export type AppRouteKeys = ${union};`,
					);
				},
			},
		},
	};
}
