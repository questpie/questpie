/**
 * Workflows Codegen Plugin
 *
 * Declares the `workflows` category for file convention codegen.
 * Register in questpie.config.ts:
 *
 * ```ts
 * import { runtimeConfig } from "questpie";
 * import { workflowsPlugin } from "@questpie/workflows/server";
 *
 * export default runtimeConfig({
 *   plugins: [workflowsPlugin()],
 *   db: { url: process.env.DATABASE_URL! },
 * });
 * ```
 *
 * Discovers `workflows/*.ts` files and generates typed `AppWorkflows` in
 * the `.generated/index.ts` output.
 *
 * @see RFC-PLUGIN-SYSTEM.md
 */

import type { CodegenPlugin } from "questpie";

/**
 * Workflows codegen plugin.
 *
 * Discovers workflow definition files:
 * - `workflows/*.ts` — durable workflow definitions using `workflow()`
 *
 * Provides scaffold template:
 * - `questpie add workflow <name>` — creates a new workflow file
 */
export function workflowsPlugin(): CodegenPlugin {
	return {
		name: "questpie-workflows",
		targets: {
			server: {
				root: ".",
				outputFile: "index.ts",
				categories: {
					workflows: {
						dirs: ["workflows"],
						prefix: "wf",
						emit: "record",
						registryKey: true,
						includeInAppState: true,
						extractFromModules: true,
					},
				},
				scaffolds: {
					workflow: {
						dir: "workflows",
						description: "Durable workflow",
						template: ({ kebab }) =>
							[
								`import { workflow } from "@questpie/workflows";`,
								`import { z } from "zod";`,
								``,
								`export default workflow({`,
								`\tname: "${kebab}",`,
								`\tschema: z.object({}),`,
								`\thandler: async ({ input, step, ctx, log }) => {`,
								`\t\t// your workflow steps here`,
								`\t},`,
								`});`,
							].join("\n"),
					},
				},
			},
		},
	};
}
