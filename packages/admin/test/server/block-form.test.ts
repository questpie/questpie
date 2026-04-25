/**
 * Block .form() and Introspection Tests
 *
 * Tests:
 * - BlockBuilder.form() stores layout config in state
 * - Block introspection includes form layout in BlockSchema
 * - Backward compatibility: blocks without .form() work as before
 */

import { describe, expect, test } from "bun:test";

import {
	block,
	BlockBuilder,
} from "#questpie/admin/server/block/block-builder.js";
import {
	introspectBlock,
	introspectBlocks,
} from "#questpie/admin/server/block/introspection.js";

// ============================================================================
// BlockBuilder.form()
// ============================================================================

describe("BlockBuilder.form()", () => {
	test("should have .form() method", () => {
		const b = block("test");
		expect(typeof b.form).toBe("function");
	});

	test("stores form config in state", () => {
		const b = block("hero")
			.fields(({ f }) => ({
				title: f.text().required(),
				subtitle: f.text(),
			}))
			.form(({ f }) => ({
				fields: [f.title, f.subtitle],
			}));

		expect(b.state.form).toBeDefined();
		expect(b.state.form?.fields).toEqual(["title", "subtitle"]);
	});

	test("supports section layout", () => {
		const b = block("pricing")
			.fields(({ f }) => ({
				title: f.text().required(),
				price: f.number(),
				currency: f.text(),
				description: f.textarea(),
			}))
			.form(({ f }) => ({
				fields: [
					{
						type: "section",
						label: "Basic",
						fields: [f.title, f.description],
					},
					{
						type: "section",
						label: "Pricing",
						layout: "grid",
						columns: 2,
						fields: [f.price, f.currency],
					},
				],
			}));

		const form = b.state.form!;
		expect(form.fields).toHaveLength(2);
		expect((form.fields[0] as any).type).toBe("section");
		expect((form.fields[0] as any).label).toBe("Basic");
		expect((form.fields[0] as any).fields).toEqual(["title", "description"]);
		expect((form.fields[1] as any).layout).toBe("grid");
		expect((form.fields[1] as any).columns).toBe(2);
	});

	test("supports tabs layout", () => {
		const b = block("hero")
			.fields(({ f }) => ({
				title: f.text(),
				image: f.upload(),
				cta: f.text(),
			}))
			.form(({ f }) => ({
				fields: [
					f.title,
					{
						type: "tabs",
						tabs: [
							{ id: "media", label: "Media", fields: [f.image] },
							{ id: "actions", label: "Actions", fields: [f.cta] },
						],
					},
				],
			}));

		const form = b.state.form!;
		expect(form.fields).toHaveLength(2);
		expect(form.fields[0]).toBe("title");
		expect((form.fields[1] as any).type).toBe("tabs");
		expect((form.fields[1] as any).tabs).toHaveLength(2);
		expect((form.fields[1] as any).tabs[0].id).toBe("media");
	});

	test("form callback receives field name proxy", () => {
		const b = block("test")
			.fields(({ f }) => ({
				name: f.text(),
				email: f.email(),
			}))
			.form(({ f }) => ({
				fields: [f.name, f.email],
			}));

		// f.name should resolve to the string "name"
		expect(b.state.form?.fields).toEqual(["name", "email"]);
	});

	test("is chainable with other methods", () => {
		const b = block("hero")
			.fields(({ f }) => ({
				title: f.text().required(),
			}))
			.form(({ f }) => ({
				fields: [f.title],
			}))
			.admin(({ c }) => ({
				label: { en: "Hero" },
				icon: c.icon("ph:image"),
			}))
			.allowChildren(4);

		expect(b.state.form).toBeDefined();
		expect(b.state.admin).toBeDefined();
		expect(b.state.allowChildren).toBe(true);
		expect(b.state.maxChildren).toBe(4);
	});

	test("returns new builder (immutability)", () => {
		const b1 = block("test").fields(({ f }) => ({
			name: f.text(),
		}));

		const b2 = b1.form(({ f }) => ({
			fields: [f.name],
		}));

		expect(b1).not.toBe(b2);
		expect(b1.state.form).toBeUndefined();
		expect(b2.state.form).toBeDefined();
	});
});

// ============================================================================
// Block Introspection — form layout
// ============================================================================

describe("Block introspection — form layout", () => {
	test("includes form in BlockSchema when defined", () => {
		const b = block("hero")
			.fields(({ f }) => ({
				title: f.text().required(),
				subtitle: f.text(),
			}))
			.form(({ f }) => ({
				fields: [
					{
						type: "section",
						label: "Content",
						fields: [f.title, f.subtitle],
					},
				],
			}))
			.build();

		const schema = introspectBlock(b);

		expect(schema.name).toBe("hero");
		expect(schema.form).toBeDefined();
		expect(schema.form?.fields).toHaveLength(1);
		expect((schema.form?.fields[0] as any).type).toBe("section");
		expect((schema.form?.fields[0] as any).fields).toEqual([
			"title",
			"subtitle",
		]);
	});

	test("form is undefined when not defined (backward compat)", () => {
		const b = block("simple")
			.fields(({ f }) => ({
				title: f.text().required(),
			}))
			.build();

		const schema = introspectBlock(b);

		expect(schema.name).toBe("simple");
		expect(schema.form).toBeUndefined();
		expect(schema.fields).toBeDefined();
	});

	test("batch introspection includes form on all blocks", () => {
		const heroBlock = block("hero")
			.fields(({ f }) => ({
				title: f.text(),
			}))
			.form(({ f }) => ({
				fields: [f.title],
			}))
			.build();

		const simpleBlock = block("simple")
			.fields(({ f }) => ({
				name: f.text(),
			}))
			.build();

		const schemas = introspectBlocks({
			hero: heroBlock,
			simple: simpleBlock,
		});

		expect(schemas.hero.form).toBeDefined();
		expect(schemas.hero.form?.fields).toEqual(["title"]);
		expect(schemas.simple.form).toBeUndefined();
	});

	test("batch introspection keys blocks by runtime name", () => {
		const imageTextBlock = block("image-text")
			.fields(({ f }) => ({
				title: f.text(),
			}))
			.build();

		const schemas = introspectBlocks({
			imageText: imageTextBlock,
		});

		expect(schemas["image-text"]?.name).toBe("image-text");
		expect(schemas.imageText).toBeUndefined();
	});

	test("introspection preserves complex layout structure", () => {
		const b = block("complex")
			.fields(({ f }) => ({
				title: f.text(),
				image: f.upload(),
				price: f.number(),
				currency: f.text(),
			}))
			.form(({ f }) => ({
				fields: [
					f.title,
					{
						type: "tabs",
						tabs: [
							{ id: "media", label: "Media", fields: [f.image] },
							{
								id: "pricing",
								label: "Pricing",
								fields: [
									{
										type: "section",
										layout: "grid",
										columns: 2,
										fields: [f.price, f.currency],
									},
								],
							},
						],
					},
				],
			}))
			.build();

		const schema = introspectBlock(b);
		const formFields = schema.form!.fields;

		expect(formFields[0]).toBe("title");
		expect((formFields[1] as any).type).toBe("tabs");
		expect((formFields[1] as any).tabs[1].fields[0].type).toBe("section");
		expect((formFields[1] as any).tabs[1].fields[0].layout).toBe("grid");
	});
});
