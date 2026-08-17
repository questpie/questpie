import { basename, resolve } from "node:path";

import type { ApplicationConfiguration, PackageInventory } from "../types";

export async function bundleApplicationEntry(
	input: Readonly<{
		entry: string;
		applicationRoot: string;
		configuration: ApplicationConfiguration;
		inventories: readonly PackageInventory[];
		readinessEntry: string;
		runtimeCoreBundleEntry: string;
		runtimeRealtimeBundleEntry: string;
	}>,
): Promise<Readonly<Record<string, string>>> {
	const packageEntries = new Map(
		input.inventories.map((inventory) => [
			`${inventory.package.name}/questpie`,
			inventory.package.entry,
		]),
	);
	const result = await Bun.build({
		entrypoints: ["questpie:application-entry"],
		target: "bun",
		format: "esm",
		splitting: true,
		naming: {
			entry: "application.js",
			chunk: "application-[hash].[ext]",
		},
		minify: { whitespace: true },
		sourcemap: "none",
		packages: "bundle",
		external: ["questpie"],
		plugins: [
			{
				name: "questpie-application-bundle",
				setup(builder) {
					builder.onResolve({ filter: /^questpie:application-entry$/ }, () => ({
						path: "application-entry",
						namespace: "questpie-entry",
					}));
					builder.onLoad({ filter: /.*/, namespace: "questpie-entry" }, () => ({
						contents: input.entry,
						loader: "ts",
					}));
					builder.onResolve({ filter: /^#questpie\/app$/ }, () => ({
						path: "authoring-app",
						namespace: "questpie-authoring",
					}));
					builder.onResolve({ filter: /^#questpie\/package$/ }, () => ({
						path: "authoring-package",
						namespace: "questpie-authoring",
					}));
					builder.onLoad(
						{ filter: /.*/, namespace: "questpie-authoring" },
						() => ({
							contents:
								'const define = (kind) => (definition) => Object.freeze({ ...definition, kind, identity: `${kind}:${definition.name}`, network: definition.network === true }); export const defineQuery = define("query"); export const defineMutation = define("mutation"); export const defineReaction = (definition) => Object.freeze({ ...definition, kind: "reaction", identity: `reaction:${definition.name}` });',
							loader: "js",
						}),
					);
					builder.onResolve({ filter: /^#questpie\/source\// }, (args) => ({
						path: resolve(
							input.applicationRoot,
							input.configuration.source.root,
							args.path.slice("#questpie/source/".length),
						),
					}));
					builder.onResolve({ filter: /^questpie:runtime-core$/ }, () => ({
						path: input.runtimeCoreBundleEntry,
					}));
					builder.onResolve({ filter: /^questpie:runtime-realtime$/ }, () => ({
						path: input.runtimeRealtimeBundleEntry,
					}));
					builder.onResolve({ filter: /^questpie:runtime-readiness$/ }, () => ({
						path: input.readinessEntry,
					}));
					builder.onResolve({ filter: /^questpie:runtime-bootstrap$/ }, () => ({
						path: input.runtimeCoreBundleEntry,
					}));
					builder.onResolve({ filter: /^questpie:runtime-ingress$/ }, () => ({
						path: input.runtimeCoreBundleEntry,
					}));
					builder.onResolve({ filter: /.*/ }, (args) => {
						const packageEntry = packageEntries.get(args.path);
						return packageEntry ? { path: packageEntry } : undefined;
					});
				},
			},
		],
	});
	if (!result.success)
		throw new TypeError(
			`Runtime Application bundle failed: ${result.logs.map((log) => log.message).join("; ")}`,
		);
	if (!result.outputs.some((item) => item.kind === "entry-point"))
		throw new TypeError("Runtime Application bundle emitted no entry");
	return Object.fromEntries(
		await Promise.all(
			result.outputs.map(async (output) => [
				`internal/${basename(output.path)}`,
				await output.text(),
			]),
		),
	);
}
