/**
 * Admin Codegen Plugin
 *
 * Declares admin-specific file conventions and builder extensions.
 * Register in questpie.config.ts:
 *
 * ```ts
 * import { runtimeConfig } from "questpie";
 * import { adminPlugin } from "@questpie/admin/plugin";
 *
 * export default runtimeConfig({
 *   plugins: [adminPlugin()],
 *   db: { url: process.env.DATABASE_URL! },
 * });
 * ```
 *
 * @see RFC-PLUGIN-SYSTEM.md
 */

import type { CodegenPlugin } from "questpie";

import { generateAdminClientTemplate } from "./codegen/admin-client-template.js";
import { createAdminProjectionValidator } from "./codegen/projection-validator.js";

/**
 * Admin codegen plugin.
 *
 * Discovers admin-specific file conventions:
 * - `views/*.ts` — custom view definitions (list, form, etc.)
 * - `components/*.ts` — component definitions with typed props
 * - `blocks/*.ts` — visual block editor blocks
 * - `sidebar.ts` — sidebar contribution
 * - `dashboard.ts` — dashboard contribution
 * - `branding.ts` — admin branding config
 * - `admin-locale.ts` — admin UI locale config
 *
 * Extends collection/global builders with:
 * - `.admin()` — admin config (label, icon, group, etc.)
 * - `.list()` — list view config (columns, sort, filter, etc.)
 * - `.form()` — form view config (fields, sidebar, tabs, etc.)
 * - `.preview()` — live preview config
 * - `.actions()` — custom actions config
 */
export function adminPlugin(): CodegenPlugin {
	return {
		name: "questpie-admin",
		validators: [createAdminProjectionValidator()],
		targets: {
			server: {
				root: ".",
				outputFile: "index.ts",
				categories: {
					views: {
						dirs: ["views"],
						prefix: "view",
						factoryFunctions: ["view"],
						registryKey: true,
						placeholder: "$VIEW_NAMES",
						recordPlaceholder: "$VIEWS_RECORD",
						includeInAppState: true,
						extractFromModules: true,
						typeEmit: "standard",
					},
					components: {
						dirs: ["components"],
						prefix: "comp",
						factoryFunctions: ["component"],
						registryKey: true,
						placeholder: "$COMPONENT_NAMES",
						recordPlaceholder: "$COMPONENTS",
						typeRegistry: {
							module: "@questpie/admin/server",
							interface: "ComponentTypeRegistry",
						},
						includeInAppState: true,
						extractFromModules: true,
						typeEmit: "standard",
					},
					blocks: {
						dirs: ["blocks"],
						prefix: "bloc",
						factoryFunctions: ["block"],
						registryKey: true,
						includeInAppState: true,
						extractFromModules: true,
						typeEmit: "standard",
					},
					// Contribute field factory imports to the core fieldTypes category.
					// The factory template uses these to import and spread-merge
					// adminFields (richText, blocks) into _allFieldDefs.
					fieldTypes: {
						dirs: ["fields"],
						prefix: "ftype",
						factoryImports: [
							{ name: "adminFields", from: "@questpie/admin/server" },
						],
					},
				},
				discover: {
					adminConfig: { pattern: "config/admin.ts", configKey: "admin" },
				},
				registries: {
					builderFactories: {
						block: {
							builderClass: "BlockBuilder",
							import: {
								name: "BlockBuilder",
								from: "@questpie/admin/server",
							},
							createMethod: "create",
							returnType:
								"import('@questpie/admin/server').BlockBuilder<{ name: TName }>",
						},
					},
					fieldExtensions: {
						admin: {
							stateKey: "admin",
							configType: "unknown",
						},
						form: {
							stateKey: "form",
							configType: "(ctx: { f: Record<string, string> }) => { fields: import('@questpie/admin/server').FieldLayoutItem[] }",
							isCallback: true,
							callbackContextParams: ["f"],
						},
					},
					collectionExtensions: {
						admin: {
							stateKey: "admin",
							imports: [
								{
									name: "AdminCollectionConfig",
									from: "@questpie/admin/server",
								},
								{
									name: "AdminConfigContext",
									from: "@questpie/admin/server",
								},
							],
							configType:
								"AdminCollectionConfig | ((ctx: AdminConfigContext<$COMPONENTS>) => AdminCollectionConfig)",
							isCallback: true,
							callbackContextParams: ["c"],
						},
						list: {
							stateKey: "adminList",
							imports: [
								{
									name: "ListViewConfig",
									from: "@questpie/admin/server",
								},
								{
									name: "ListViewConfigContext",
									from: "@questpie/admin/server",
								},
								{
									name: "FilterViewsByKind",
									from: "@questpie/admin/server",
								},
							],
							configType:
								'(ctx: ListViewConfigContext<TState extends { fieldDefinitions: infer F extends Record<string, any> } ? F : Record<string, any>, FilterViewsByKind<$VIEWS_RECORD, "list">>) => ListViewConfig',
							isCallback: true,
							callbackContextParams: ["v", "f", "a"],
							defaults: {
								view: "collection-table",
								showSearch: true,
								showFilters: true,
								showToolbar: true,
							},
						},
						form: {
							stateKey: "adminForm",
							imports: [
								{
									name: "FormViewConfig",
									from: "@questpie/admin/server",
								},
								{
									name: "FormViewConfigContext",
									from: "@questpie/admin/server",
								},
								{
									name: "FilterViewsByKind",
									from: "@questpie/admin/server",
								},
							],
							configType:
								'(ctx: FormViewConfigContext<TState extends { fieldDefinitions: infer F extends Record<string, any> } ? F : Record<string, any>, FilterViewsByKind<$VIEWS_RECORD, "form">>) => FormViewConfig',
							isCallback: true,
							callbackContextParams: ["v", "f"],
							defaults: {
								view: "collection-form",
								showMeta: true,
							},
						},
						preview: {
							stateKey: "adminPreview",
							imports: [
								{
									name: "PreviewConfig",
									from: "@questpie/admin/server",
								},
							],
							configType: "PreviewConfig",
						},
						actions: {
							stateKey: "adminActions",
							imports: [
								{
									name: "ServerActionsConfig",
									from: "@questpie/admin/server",
								},
								{
									name: "ActionsConfigContext",
									from: "@questpie/admin/server",
								},
							],
							configType:
								"(ctx: ActionsConfigContext<Record<string, unknown>, $COMPONENTS>) => ServerActionsConfig",
							isCallback: true,
							callbackContextParams: ["a", "c", "f"],
						},
					},
					globalExtensions: {
						admin: {
							stateKey: "admin",
							imports: [
								{
									name: "AdminGlobalConfig",
									from: "@questpie/admin/server",
								},
								{
									name: "AdminConfigContext",
									from: "@questpie/admin/server",
								},
							],
							configType:
								"AdminGlobalConfig | ((ctx: AdminConfigContext<$COMPONENTS>) => AdminGlobalConfig)",
							isCallback: true,
							callbackContextParams: ["c"],
						},
						form: {
							stateKey: "adminForm",
							imports: [
								{
									name: "FormViewConfig",
									from: "@questpie/admin/server",
								},
								{
									name: "FormViewConfigContext",
									from: "@questpie/admin/server",
								},
								{
									name: "FilterViewsByKind",
									from: "@questpie/admin/server",
								},
							],
							configType:
								'(ctx: FormViewConfigContext<TState extends { fieldDefinitions: infer F extends Record<string, any> } ? F : Record<string, any>, FilterViewsByKind<$VIEWS_RECORD, "form">>) => FormViewConfig',
							isCallback: true,
							callbackContextParams: ["v", "f"],
							defaults: {
								view: "global-form",
								showMeta: true,
							},
						},
					},
					singletonFactories: {
						adminConfig: {
							configType: "AdminConfigInput",
							imports: [
								{
									name: "AdminConfigInput",
									from: "@questpie/admin/server",
								},
							],
							isCallback: true,
						},
					},
				},
				transform(_ctx) {
					// Dashboard is now part of config.admin — no need for empty stubs.
					// Admin reads it from app.state.config.admin.dashboard at runtime.
				},
				callbackParams: {
					v: {
						factory: "createViewCallbackProxy",
						from: "@questpie/admin/server",
					},
					c: {
						factory: "createComponentCallbackProxy",
						from: "@questpie/admin/server",
					},
					a: {
						factory: "createActionCallbackProxy",
						from: "@questpie/admin/server",
					},
				},
				scaffolds: {
					block: {
						dir: "blocks",
						description: "Server-side block definition",
						template: ({ kebab, camel }) =>
							`import { block } from "#questpie/factories";\n\nexport const ${camel}Block = block("${kebab}")\n\t.fields(({ f }) => ({\n\t\ttitle: f.text("Title"),\n\t}));\n`,
					},
					view: {
						dir: "views",
						description: "Server-side view definition",
						template: ({ kebab, camel }) =>
							`import { view } from "@questpie/admin/server";\n\nexport const ${camel}View = view("${kebab}", "list", {\n\t// TODO: configure view\n});\n`,
					},
					component: {
						dir: "components",
						description: "Server-side component definition",
						template: ({ kebab, camel }) =>
							`import { component } from "@questpie/admin/server";\n\nexport const ${camel}Component = component("${kebab}", {\n\t// TODO: configure component props\n});\n`,
					},
				},
			},

			// ── admin-client target ──────────────────────────────────
			// Discovers client-side admin files (blocks, views, components,
			// fields, pages, widgets) and generates a pre-built admin config.
			"admin-client": {
				root: "../admin",
				outputFile: "client.ts",
				moduleRoot: "client",

				categories: {
					blocks: {
						dirs: ["blocks"],
						prefix: "block",
						registryKey: false,
						includeInAppState: false,
						extractFromModules: false,
					},
					views: {
						dirs: ["views"],
						prefix: "view",
						registryKey: false,
						includeInAppState: false,
						extractFromModules: false,
						keyFromProperty: "name",
					},
					components: {
						dirs: ["components"],
						prefix: "comp",
						registryKey: false,
						includeInAppState: false,
						extractFromModules: false,
					},
					fields: {
						dirs: ["fields"],
						prefix: "fld",
						registryKey: false,
						includeInAppState: false,
						extractFromModules: false,
					},
					pages: {
						dirs: ["pages"],
						prefix: "pg",
						registryKey: false,
						includeInAppState: false,
						extractFromModules: false,
					},
					widgets: {
						dirs: ["widgets"],
						prefix: "wgt",
						registryKey: false,
						includeInAppState: false,
						extractFromModules: false,
					},
				},

				discover: {
					modules: "modules.ts",
					locale: "locale.ts",
					translations: "translations.ts",
					defaults: "defaults.ts",
				},

				transform(ctx) {
					const blockFiles = ctx.categories.get("blocks");
					if (!blockFiles || blockFiles.size === 0) return;

					// Add framework type imports
					ctx.addImport(
						"type { BlockRendererProps }",
						"@questpie/admin/client",
					);
					ctx.addImport(
						"type { InferBlockValues, InferBlockData }",
						"@questpie/admin/server",
					);

					// Add per-block server type imports and build the map entries
					const entries: string[] = [];
					for (const [key, file] of [...blockFiles.entries()].sort(([a], [b]) =>
						a.localeCompare(b),
					)) {
						const varName = `${key}Block`;
						// Derive kebab-case filename from the client import path
						const kebab = file.importPath.split("/").pop()!;
						ctx.addImport(
							`type { ${varName} }`,
							`../../server/blocks/${kebab}`,
						);
						entries.push(`${JSON.stringify(key)}: typeof ${varName}`);
					}

					// Emit _ServerBlocks map + BlockProps<T> helper
					ctx.addTypeDeclaration(
						`type _ServerBlocks = { ${entries.join("; ")} };`,
					);
					ctx.addTypeDeclaration("");
					ctx.addTypeDeclaration(
						"export type BlockProps<T extends keyof _ServerBlocks> = BlockRendererProps<",
					);
					ctx.addTypeDeclaration(
						'\tInferBlockValues<_ServerBlocks[T]["state"]>,',
					);
					ctx.addTypeDeclaration("\tInferBlockData<_ServerBlocks[T]>");
					ctx.addTypeDeclaration(">;");
				},

				scaffolds: {
					block: {
						dir: "blocks",
						extension: ".tsx",
						description: "Client-side block renderer",
						template: ({ kebab, pascal }) =>
							`import type { BlockProps } from "../.generated/client";\n\nexport default function ${pascal}Block({ values, children }: BlockProps<"${kebab}">) {\n\treturn (\n\t\t<div>\n\t\t\t<h2>${pascal} Block</h2>\n\t\t\t{/* TODO: implement block renderer */}\n\t\t</div>\n\t);\n}\n`,
					},
					view: {
						dir: "views",
						extension: ".tsx",
						description: "Client-side view component",
						template: ({ kebab, pascal }) =>
							`import { defineView } from "@questpie/admin";\n\nexport default defineView("${kebab}", (props) => {\n\treturn (\n\t\t<div>\n\t\t\t<h2>${pascal} View</h2>\n\t\t\t{/* TODO: implement view */}\n\t\t</div>\n\t);\n});\n`,
					},
					field: {
						dir: "fields",
						extension: ".tsx",
						description: "Client-side field component",
						template: ({ kebab, pascal }) =>
							`import { field } from "@questpie/admin";\n\nexport default field({\n\tname: "${kebab}",\n\tcomponent: (props) => {\n\t\treturn (\n\t\t\t<div>\n\t\t\t\t<label>${pascal}</label>\n\t\t\t\t{/* TODO: implement field */}\n\t\t\t</div>\n\t\t);\n\t},\n});\n`,
					},
					widget: {
						dir: "widgets",
						extension: ".tsx",
						description: "Client-side dashboard widget",
						template: ({ kebab, pascal }) =>
							`import { defineWidget } from "@questpie/admin";\n\nexport default defineWidget("${kebab}", (props) => {\n\treturn (\n\t\t<div>\n\t\t\t<h3>${pascal} Widget</h3>\n\t\t\t{/* TODO: implement widget */}\n\t\t</div>\n\t);\n});\n`,
					},
				},

				generate: (ctx) => generateAdminClientTemplate(ctx),
			},
		},
	};
}
