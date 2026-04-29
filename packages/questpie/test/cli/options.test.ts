import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

import {
	parseCsvOption,
	parsePositiveIntegerOption,
	parseSeedCategoryOption,
	resolveCliPath,
	toFileImportSpecifier,
} from "../../src/cli/utils.js";

describe("CLI option helpers", () => {
	it("resolves relative paths from cwd and preserves absolute paths", () => {
		expect(resolveCliPath("questpie.config.ts", "/tmp/project")).toBe(
			resolve("/tmp/project", "questpie.config.ts"),
		);
		expect(resolveCliPath("/tmp/project/questpie.config.ts")).toBe(
			"/tmp/project/questpie.config.ts",
		);
	});

	it("rejects empty paths", () => {
		expect(() => resolveCliPath("   ")).toThrow("Path must not be empty");
	});

	it("converts file paths to import-safe file URLs", () => {
		expect(toFileImportSpecifier("/tmp/project/questpie config.ts")).toBe(
			"file:///tmp/project/questpie%20config.ts",
		);
	});

	it("parses comma-separated options with trimming", () => {
		expect(parseCsvOption("alpha, beta,,gamma ")).toEqual([
			"alpha",
			"beta",
			"gamma",
		]);
		expect(parseCsvOption(" ,, ")).toBeUndefined();
	});

	it("validates seed categories", () => {
		expect(parseSeedCategoryOption("required, dev")).toEqual([
			"required",
			"dev",
		]);
		expect(() => parseSeedCategoryOption("demo")).toThrow(
			'Invalid seed category "demo"',
		);
	});

	it("parses positive integer options strictly", () => {
		expect(parsePositiveIntegerOption("12", "--batch")).toBe(12);
		expect(() => parsePositiveIntegerOption("1abc", "--batch")).toThrow(
			"--batch must be a positive integer",
		);
		expect(() => parsePositiveIntegerOption("0", "--batch")).toThrow(
			"--batch must be a positive integer",
		);
	});
});
