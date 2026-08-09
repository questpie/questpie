import { describe, expect, it } from "bun:test";

import { extractPluginsFromModules } from "../../src/cli/codegen/extract-plugins.js";
import { resolveTargetGraph } from "../../src/cli/codegen/index.js";
import {
	CODEGEN_MODULE_METADATA_SYMBOL,
	extractFactoryArgumentsFromModules,
} from "../../src/cli/codegen/module-metadata.js";
import type { CodegenPlugin } from "../../src/cli/codegen/types.js";

type ModuleFixture = {
	name: string;
	modules?: ModuleFixture[];
	plugin?: CodegenPlugin | CodegenPlugin[];
	[key: symbol]: unknown;
};

const plugin = (name: string): CodegenPlugin => ({ name, targets: {} });

describe("codegen module and plugin graph", () => {
	it("deduplicates same-object diamonds in children-before-parent order", () => {
		const sharedPlugin = plugin("shared-plugin");
		const shared: ModuleFixture = { name: "shared", plugin: sharedPlugin };
		const leftPlugin = plugin("left-plugin");
		const rightPlugin = plugin("right-plugin");
		const left: ModuleFixture = {
			name: "left",
			modules: [shared],
			plugin: leftPlugin,
		};
		const right: ModuleFixture = {
			name: "right",
			modules: [shared],
			plugin: rightPlugin,
		};

		expect(extractPluginsFromModules([left, right])).toEqual([
			sharedPlugin,
			leftPlugin,
			rightPlugin,
		]);
	});

	it("rejects module cycles with an actionable path", () => {
		const alpha: ModuleFixture = { name: "alpha" };
		const beta: ModuleFixture = { name: "beta", modules: [alpha] };
		alpha.modules = [beta];

		expect(() => extractPluginsFromModules([alpha])).toThrow(
			/Circular module dependency: alpha -> beta -> alpha/,
		);
	});

	it("rejects different module objects sharing one name", () => {
		const first: ModuleFixture = { name: "shared" };
		const second: ModuleFixture = { name: "shared" };

		expect(() =>
			extractPluginsFromModules([
				{ name: "left", modules: [first] },
				{ name: "right", modules: [second] },
			]),
		).toThrow(/left -> shared.*right -> shared/s);
	});

	it("rejects different module objects sharing an empty name", () => {
		expect(() =>
			extractPluginsFromModules([{ name: "" }, { name: "" }]),
		).toThrow(/different modules are both named ""/i);
	});

	it("rejects different plugin objects sharing one name", () => {
		expect(() =>
			extractPluginsFromModules([
				{ name: "first", plugin: plugin("collision") },
				{ name: "second", plugin: plugin("collision") },
			]),
		).toThrow(/different plugins.*"collision"/i);
	});

	it("enforces plugin identity at direct target-graph ingress", () => {
		const shared = plugin("shared");
		expect(resolveTargetGraph([shared, shared])).toEqual(new Map());
		expect(() =>
			resolveTargetGraph([plugin("collision"), plugin("collision")]),
		).toThrow(/different plugins.*"collision"/i);
	});

	it("applies the same module collision policy to metadata", () => {
		const symbol = Symbol.for(CODEGEN_MODULE_METADATA_SYMBOL);
		const first: ModuleFixture = {
			name: "shared",
			[symbol]: { factoryArguments: [] },
		};
		const second: ModuleFixture = {
			name: "shared",
			[symbol]: { factoryArguments: [] },
		};

		expect(() => extractFactoryArgumentsFromModules([first, second])).toThrow(
			/different modules.*"shared"/i,
		);
	});

	it("extracts metadata in the same children-before-parent order", () => {
		const symbol = Symbol.for(CODEGEN_MODULE_METADATA_SYMBOL);
		const withMetadata = (name: string, modules?: ModuleFixture[]) => ({
			name,
			modules,
			[symbol]: {
				factoryArguments: [
					{
						category: "blocks",
						key: name,
						value: name,
						source: `${name}.ts`,
					},
				],
			},
		});
		const shared = withMetadata("shared");
		const left = withMetadata("left", [shared]);
		const right = withMetadata("right", [shared]);

		expect(
			extractFactoryArgumentsFromModules([left, right]).map(
				(entry) => entry.key,
			),
		).toEqual(["shared", "left", "right"]);
	});
});
