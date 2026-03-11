import type { CodegenPlugin } from "questpie";

/**
 * Codegen plugin for durable workflows.
 *
 * Discovers workflow definitions from `workflows/` directories
 * and generates typed `AppWorkflows` + `ctx.workflows` augmentation.
 *
 * @example
 * ```ts
 * // questpie.config.ts
 * import { workflowsPlugin } from "@questpie/workflows";
 *
 * export default runtimeConfig({
 *   plugins: [workflowsPlugin()],
 * });
 * ```
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
						registryKey: true,
						includeInAppState: true,
						extractFromModules: true,
					},
				},
				transform(ctx) {
					const workflows = ctx.categories.get("workflows");
					if (!workflows || workflows.size === 0) return;

					// Add type augmentation for ctx.workflows
					ctx.addImport(
						"WorkflowClient",
						"@questpie/workflows",
					);
					ctx.addImport(
						"WorkflowHandle",
						"@questpie/workflows",
					);

					ctx.addTypeDeclaration(`
declare module "questpie" {
	interface AppContext {
		workflows: WorkflowClient<Registry["workflows"]>;
	}
}`);
				},
				scaffolds: {
					workflow: {
						dir: "workflows",
						description: "Durable workflow",
						template: ({ kebab }) =>
							`import { workflow } from "questpie";\nimport { z } from "zod";\n\nexport default workflow({\n\tname: "${kebab}",\n\tschema: z.object({}),\n\thandler: async ({ step, input, log }) => {\n\t\tawait step.run("first-step", async () => {\n\t\t\t// TODO: implement\n\t\t});\n\t},\n});\n`,
					},
				},
			},
		},
	};
}
