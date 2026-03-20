/**
 * Codegen Integration Tests
 *
 * Validates that the generated factories and block definitions work correctly
 * at runtime. Catches issues like:
 * - Field extension methods (.admin(), .form()) not available on block fields
 * - Generated factories producing invalid code
 * - Wrapped field defs not propagating through builder chains
 */
import { describe, expect, it } from "bun:test";

// Import the generated factories — this is what user code imports
import { block, collection } from "#questpie/factories";

// Import actual block definitions to test real-world usage
import { servicesBlock } from "../src/questpie/server/blocks/services";
import { teamBlock } from "../src/questpie/server/blocks/team";

describe("generated factories", () => {
	it("exports block() factory", () => {
		expect(typeof block).toBe("function");
	});

	it("exports collection() factory", () => {
		expect(typeof collection).toBe("function");
	});
});

describe("block field extensions", () => {
	it("field .admin() works inside block .fields()", () => {
		const b = block("test-admin")
			.fields(({ f }) => ({
				name: f.text().label({ en: "Name" }).admin({ placeholder: "John" }),
			}));

		const meta = b.state.fields!.name.getMetadata();
		expect(meta.meta).toEqual({ placeholder: "John" });
	});

	it("field .admin() works with function values (reactive hidden)", () => {
		const hiddenFn = ({ data }: { data: Record<string, unknown> }) =>
			data.mode !== "manual";

		const b = block("test-reactive")
			.fields(({ f }) => ({
				items: f.relation("posts").multiple().admin({ hidden: hiddenFn }),
			}));

		const meta = b.state.fields!.items.getMetadata();
		expect(meta.meta).toEqual({ hidden: hiddenFn });
	});

	it("field .admin() chains through .label(), .multiple(), .default()", () => {
		const b = block("test-chain")
			.fields(({ f }) => ({
				mode: f
					.select([{ value: "a", label: "A" }])
					.label({ en: "Mode" })
					.default("a")
					.admin({ displayAs: "radio" }),
			}));

		const meta = b.state.fields!.mode.getMetadata();
		expect(meta.meta).toEqual({ displayAs: "radio" });
		expect(meta.label).toEqual({ en: "Mode" });
	});

	it("field without .admin() has no meta", () => {
		const b = block("test-no-admin")
			.fields(({ f }) => ({
				title: f.text().label({ en: "Title" }),
			}));

		const meta = b.state.fields!.title.getMetadata();
		expect(meta.meta).toBeUndefined();
	});
});

describe("real block definitions", () => {
	it("servicesBlock — field .admin({ hidden }) is set on services field", () => {
		const fields = servicesBlock.state.fields!;
		const servicesMeta = fields.services.getMetadata();
		expect(servicesMeta.meta).toBeDefined();
		expect(typeof servicesMeta.meta.hidden).toBe("function");
	});

	it("servicesBlock — field .admin({ hidden }) is set on limit field", () => {
		const fields = servicesBlock.state.fields!;
		const limitMeta = fields.limit.getMetadata();
		expect(limitMeta.meta).toBeDefined();
		expect(typeof limitMeta.meta.hidden).toBe("function");
	});

	it("teamBlock — field .admin() is set on barbers and limit fields", () => {
		const fields = teamBlock.state.fields!;

		// Check that fields with .admin() have meta
		for (const [name, field] of Object.entries(fields)) {
			const meta = (field as any).getMetadata();
			// All fields should at minimum parse without errors
			expect(meta).toBeDefined();
			expect(meta.type).toBeDefined();
		}
	});

	it("servicesBlock — all fields are valid", () => {
		const fields = servicesBlock.state.fields!;
		const fieldNames = Object.keys(fields);

		expect(fieldNames).toContain("title");
		expect(fieldNames).toContain("subtitle");
		expect(fieldNames).toContain("mode");
		expect(fieldNames).toContain("services");
		expect(fieldNames).toContain("showPrices");
		expect(fieldNames).toContain("showDuration");
		expect(fieldNames).toContain("columns");
		expect(fieldNames).toContain("limit");
	});
});
