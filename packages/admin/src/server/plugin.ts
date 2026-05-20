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

import type { CodegenPlugin } from "questpie/codegen";

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
							module: "@questpie/admin/factories",
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
						keyFromProperty: "state.name",
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
							{ name: "adminFields", from: "@questpie/admin/fields" },
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
								from: "@questpie/admin/factories",
							},
							createMethod: "create",
							returnType:
								"import('@questpie/admin/factories').BlockBuilder<{ name: TName }>",
						},
					},
					fieldExtensions: {
						admin: {
							stateKey: "admin",
							configType: "unknown",
						},
						form: {
							stateKey: "form",
							configType:
								"(ctx: { f: Record<string, string> }) => { fields: import('@questpie/admin/factories').FieldLayoutItem[] }",
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
									from: "@questpie/admin/factories",
								},
								{
									name: "AdminConfigContext",
									from: "@questpie/admin/factories",
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
									from: "@questpie/admin/factories",
								},
								{
									name: "ListViewConfigContext",
									from: "@questpie/admin/factories",
								},
								{
									name: "FilterViewsByKind",
									from: "@questpie/admin/factories",
								},
							],
							configType:
								'(ctx: ListViewConfigContext<TState extends { fieldDefinitions: infer F extends Record<string, unknown> } ? F : Record<string, unknown>, FilterViewsByKind<$VIEWS_RECORD, "list">>) => ListViewConfig',
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
									from: "@questpie/admin/factories",
								},
								{
									name: "FormViewConfigContext",
									from: "@questpie/admin/factories",
								},
								{
									name: "FilterViewsByKind",
									from: "@questpie/admin/factories",
								},
							],
							configType:
								'(ctx: FormViewConfigContext<TState extends { fieldDefinitions: infer F extends Record<string, unknown> } ? F : Record<string, unknown>, FilterViewsByKind<$VIEWS_RECORD, "form">>) => FormViewConfig',
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
									from: "@questpie/admin/factories",
								},
							],
							configType: "PreviewConfig",
						},
						actions: {
							stateKey: "adminActions",
							imports: [
								{
									name: "ServerActionsConfig",
									from: "@questpie/admin/factories",
								},
								{
									name: "ActionsConfigContext",
									from: "@questpie/admin/factories",
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
									from: "@questpie/admin/factories",
								},
								{
									name: "AdminConfigContext",
									from: "@questpie/admin/factories",
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
									from: "@questpie/admin/factories",
								},
								{
									name: "FormViewConfigContext",
									from: "@questpie/admin/factories",
								},
								{
									name: "FilterViewsByKind",
									from: "@questpie/admin/factories",
								},
							],
							configType:
								'(ctx: FormViewConfigContext<TState extends { fieldDefinitions: infer F extends Record<string, unknown> } ? F : Record<string, unknown>, FilterViewsByKind<$VIEWS_RECORD, "form">>) => FormViewConfig',
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
									from: "@questpie/admin/factories",
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
						from: "@questpie/admin/factories",
					},
					c: {
						factory: "createComponentCallbackProxy",
						from: "@questpie/admin/factories",
					},
					a: {
						factory: "createActionCallbackProxy",
						from: "@questpie/admin/factories",
					},
				},
				scaffolds: {
					block: {
						dir: "blocks",
						description: "Server-side block definition",
						template: ({ kebab, camel }) =>
							`import { block } from "#questpie/factories";\n\nexport const ${camel}Block = block("${kebab}")\n\t.fields(({ f }) => ({\n\t\ttitle: f.text(255).label("Title").required(),\n\t}));\n`,
					},
					view: {
						dir: "views",
						description: "Server-side view definition",
						template: ({ kebab, camel }) =>
							`import { view } from "@questpie/admin/factories";\n\nexport const ${camel}View = view("${kebab}", {\n\tkind: "list",\n});\n`,
					},
					component: {
						dir: "components",
						description: "Server-side component definition",
						template: ({ kebab, camel }) =>
							`import { component } from "@questpie/admin/factories";\n\nexport const ${camel}Component = component("${kebab}", {\n\t// TODO: configure component props\n});\n`,
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
						keyFromSource: "basename",
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
						"@questpie/admin/factories",
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
						entries.push(`${JSON.stringify(kebab)}: typeof ${varName}`);
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
							`import { type CollectionListViewProps, view } from "@questpie/admin/client";\n\nfunction ${pascal}View(_props: CollectionListViewProps) {\n\treturn (\n\t\t<div>\n\t\t\t<h2>${pascal} View</h2>\n\t\t\t{/* TODO: implement view */}\n\t\t</div>\n\t);\n}\n\nexport default view("${kebab}", {\n\tkind: "list",\n\tcomponent: ${pascal}View,\n});\n`,
					},
					field: {
						dir: "fields",
						extension: ".tsx",
						description: "Client-side field component",
						template: ({ kebab, pascal }) =>
							`import { type BaseFieldProps, field } from "@questpie/admin/client";\n\nfunction ${pascal}Field({ label, value, onChange, onBlur }: BaseFieldProps) {\n\treturn (\n\t\t<label>\n\t\t\t<span>{label ?? "${pascal}"}</span>\n\t\t\t<input\n\t\t\t\tvalue={typeof value === "string" ? value : ""}\n\t\t\t\tonChange={(event) => onChange?.(event.target.value)}\n\t\t\t\tonBlur={onBlur}\n\t\t\t/>\n\t\t</label>\n\t);\n}\n\nexport default field("${kebab}", {\n\tcomponent: ${pascal}Field,\n});\n`,
					},
					widget: {
						dir: "widgets",
						extension: ".tsx",
						description: "Client-side dashboard widget",
						template: ({ kebab, pascal }) =>
							`import { type WidgetComponentProps, widget } from "@questpie/admin/client";\n\nfunction ${pascal}Widget(_props: WidgetComponentProps) {\n\treturn (\n\t\t<div>\n\t\t\t<h3>${pascal} Widget</h3>\n\t\t\t{/* TODO: implement widget */}\n\t\t</div>\n\t);\n}\n\nexport default widget("${kebab}", {\n\tcomponent: ${pascal}Widget,\n});\n`,
					},
				},

				generate: (ctx) => generateAdminClientTemplate(ctx),
			},
		},
	};
}
