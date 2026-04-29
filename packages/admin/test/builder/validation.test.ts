/**
 * Validation Schema Builder Tests
 *
 * Tests for buildZodFromIntrospection, buildValidationSchema, and nested field validation.
 * Uses FieldInstance objects (field + server-provided options) directly.
 */

import { describe, expect, it } from "bun:test";

import { z } from "zod";

import type { FieldInstance } from "#questpie/admin/client/builder/field/field";
import {
	buildValidationSchema,
	createFormSchema,
} from "#questpie/admin/client/builder/validation";

// ============================================================================
// Helpers — create FieldInstance objects for testing
// ============================================================================

function fi(name: string, options: Record<string, any> = {}): FieldInstance {
	return Object.freeze({
		name,
		component: () => null,
		"~options": options,
	}) as FieldInstance;
}

/**
 * Helper to create nested field instances from callback-based schemas.
 * Provides a registry-like `r` object that creates FieldInstance objects.
 */
function createNestedRegistry() {
	const r: Record<string, (opts?: Record<string, any>) => FieldInstance> = {};
	const fieldTypes = [
		"text",
		"textarea",
		"email",
		"number",
		"boolean",
		"select",
		"date",
		"datetime",
		"time",
		"relation",
		"upload",
		"object",
		"array",
		"json",
	];
	for (const type of fieldTypes) {
		r[type] = (opts?: Record<string, any>) => fi(type, opts ?? {});
	}
	return { r };
}

describe("buildValidationSchema", () => {
	describe("simple fields", () => {
		it("should generate schema for required text field", () => {
			const fields = {
				name: fi("text", { required: true }),
			};

			const schema = buildValidationSchema(fields);

			expect(() => schema.parse({ name: "John" })).not.toThrow();
			expect(() => schema.parse({ name: "" })).not.toThrow();
			expect(() => schema.parse({})).toThrow();
		});

		it("should generate schema for optional text field", () => {
			const fields = {
				name: fi("text", { required: false }),
			};

			const schema = buildValidationSchema(fields);

			expect(() => schema.parse({ name: "John" })).not.toThrow();
			expect(() => schema.parse({ name: null })).not.toThrow();
			expect(() => schema.parse({})).not.toThrow();
		});

		it("should apply maxLength constraint", () => {
			const fields = {
				name: fi("text", { required: true, maxLength: 5 }),
			};

			const schema = buildValidationSchema(fields);

			expect(() => schema.parse({ name: "John" })).not.toThrow();
			expect(() => schema.parse({ name: "Jonathan" })).toThrow();
		});

		it("should generate schema for email field", () => {
			const fields = {
				email: fi("email", { required: true }),
			};

			const schema = buildValidationSchema(fields);

			expect(() => schema.parse({ email: "test@example.com" })).not.toThrow();
			expect(() => schema.parse({ email: "not-an-email" })).toThrow();
		});

		it("should generate schema for number field with min/max", () => {
			const fields = {
				age: fi("number", { required: true, min: 0, max: 120 }),
			};

			const schema = buildValidationSchema(fields);

			expect(() => schema.parse({ age: 25 })).not.toThrow();
			expect(() => schema.parse({ age: -1 })).toThrow();
			expect(() => schema.parse({ age: 150 })).toThrow();
		});

		it("should generate schema for boolean field", () => {
			const fields = {
				active: fi("boolean", { required: true }),
			};

			const schema = buildValidationSchema(fields);

			expect(() => schema.parse({ active: true })).not.toThrow();
			expect(() => schema.parse({ active: false })).not.toThrow();
			expect(() => schema.parse({ active: "yes" })).toThrow();
		});

		it("should generate schema for select field with options", () => {
			const fields = {
				status: fi("select", {
					required: true,
					options: [
						{ label: "Active", value: "active" },
						{ label: "Inactive", value: "inactive" },
					],
				}),
			};

			const schema = buildValidationSchema(fields);

			expect(() => schema.parse({ status: "active" })).not.toThrow();
			expect(() => schema.parse({ status: "inactive" })).not.toThrow();
			expect(() => schema.parse({ status: "unknown" })).toThrow();
		});
	});

	describe("nested object fields", () => {
		it("should generate schema for simple nested object", () => {
			const { r } = createNestedRegistry();
			const fields = {
				address: fi("object", {
					required: true,
					fields: ({ r: _r }: any) => ({
						street: r.text({ required: true }),
						city: r.text({ required: true }),
						zip: r.text(),
					}),
				}),
			};

			const schema = buildValidationSchema(fields);

			expect(() =>
				schema.parse({
					address: { street: "123 Main St", city: "NYC", zip: "10001" },
				}),
			).not.toThrow();

			expect(() =>
				schema.parse({
					address: { street: "123 Main St", city: "NYC" },
				}),
			).not.toThrow();

			expect(() =>
				schema.parse({
					address: { street: "123 Main St" },
				}),
			).toThrow();
		});

		it("should generate schema for deeply nested objects", () => {
			const { r } = createNestedRegistry();
			const fields = {
				company: fi("object", {
					required: true,
					fields: () => ({
						name: r.text({ required: true }),
						headquarters: r.object({
							required: true,
							fields: () => ({
								country: r.text({ required: true }),
								address: r.object({
									fields: () => ({
										street: r.text({ required: true }),
										city: r.text({ required: true }),
									}),
								}),
							}),
						}),
					}),
				}),
			};

			const schema = buildValidationSchema(fields);

			expect(() =>
				schema.parse({
					company: {
						name: "Acme Inc",
						headquarters: {
							country: "USA",
							address: {
								street: "123 Main St",
								city: "NYC",
							},
						},
					},
				}),
			).not.toThrow();

			expect(() =>
				schema.parse({
					company: {
						name: "Acme Inc",
						headquarters: {
							country: "USA",
							address: {
								street: "123 Main St",
							},
						},
					},
				}),
			).toThrow();
		});

		it("should handle optional nested objects", () => {
			const { r } = createNestedRegistry();
			const fields = {
				profile: fi("object", {
					fields: () => ({
						bio: r.text(),
						website: r.text(),
					}),
				}),
			};

			const schema = buildValidationSchema(fields);

			expect(() =>
				schema.parse({
					profile: { bio: "Hello", website: "https://example.com" },
				}),
			).not.toThrow();

			expect(() => schema.parse({ profile: null })).not.toThrow();
			expect(() => schema.parse({})).not.toThrow();
		});
	});

	describe("array fields", () => {
		it("should generate schema for primitive array", () => {
			const fields = {
				tags: fi("array", {
					required: true,
					itemType: "text",
				}),
			};

			const schema = buildValidationSchema(fields);

			expect(() => schema.parse({ tags: ["a", "b", "c"] })).not.toThrow();
			expect(() => schema.parse({ tags: [] })).not.toThrow();
			expect(() => schema.parse({ tags: "not-array" })).toThrow();
		});

		it("should apply minItems/maxItems constraints", () => {
			const fields = {
				items: fi("array", {
					required: true,
					itemType: "text",
					minItems: 1,
					maxItems: 3,
				}),
			};

			const schema = buildValidationSchema(fields);

			expect(() => schema.parse({ items: ["a"] })).not.toThrow();
			expect(() => schema.parse({ items: ["a", "b", "c"] })).not.toThrow();
			expect(() => schema.parse({ items: [] })).toThrow();
			expect(() => schema.parse({ items: ["a", "b", "c", "d"] })).toThrow();
		});

		it("should generate schema for array of objects", () => {
			const { r } = createNestedRegistry();
			const fields = {
				contacts: fi("array", {
					required: true,
					item: () => ({
						name: r.text({ required: true }),
						email: r.email({ required: true }),
						phone: r.text(),
					}),
				}),
			};

			const schema = buildValidationSchema(fields);

			expect(() =>
				schema.parse({
					contacts: [
						{ name: "John", email: "john@example.com", phone: "123" },
						{ name: "Jane", email: "jane@example.com" },
					],
				}),
			).not.toThrow();

			expect(() =>
				schema.parse({
					contacts: [{ name: "John", email: "not-an-email" }],
				}),
			).toThrow();

			expect(() =>
				schema.parse({
					contacts: [{ email: "john@example.com" }],
				}),
			).toThrow();
		});

		it("should generate schema for nested arrays with objects", () => {
			const { r } = createNestedRegistry();
			const fields = {
				departments: fi("array", {
					required: true,
					item: () => ({
						name: r.text({ required: true }),
						employees: r.array({
							required: true,
							item: () => ({
								firstName: r.text({ required: true }),
								lastName: r.text({ required: true }),
							}),
						}),
					}),
				}),
			};

			const schema = buildValidationSchema(fields);

			expect(() =>
				schema.parse({
					departments: [
						{
							name: "Engineering",
							employees: [
								{ firstName: "John", lastName: "Doe" },
								{ firstName: "Jane", lastName: "Smith" },
							],
						},
					],
				}),
			).not.toThrow();

			expect(() =>
				schema.parse({
					departments: [
						{
							name: "Engineering",
							employees: [{ firstName: "John" }],
						},
					],
				}),
			).toThrow();
		});
	});

	describe("relation fields", () => {
		it("should generate schema for single relation", () => {
			const fields = {
				authorId: fi("relation", {
					required: true,
					targetCollection: "users",
					type: "single",
				}),
			};

			const schema = buildValidationSchema(fields);

			expect(() => schema.parse({ authorId: "user-123" })).not.toThrow();
			expect(() => schema.parse({})).toThrow();
		});

		it("should generate schema for multiple relation", () => {
			const fields = {
				tagIds: fi("relation", {
					required: true,
					targetCollection: "tags",
					type: "multiple",
					maxItems: 5,
				}),
			};

			const schema = buildValidationSchema(fields);

			expect(() => schema.parse({ tagIds: ["tag-1", "tag-2"] })).not.toThrow();
			expect(() =>
				schema.parse({ tagIds: ["1", "2", "3", "4", "5", "6"] }),
			).toThrow();
		});
	});

	describe("url fields", () => {
		it("should validate url format", () => {
			const fields = {
				website: fi("url", { required: true }),
			};

			const schema = buildValidationSchema(fields);

			expect(() =>
				schema.parse({ website: "https://example.com" }),
			).not.toThrow();
			expect(() =>
				schema.parse({ website: "http://localhost:3000/path" }),
			).not.toThrow();
			expect(() => schema.parse({ website: "not-a-url" })).toThrow();
		});

		it("should allow optional url", () => {
			const fields = {
				website: fi("url", { required: false }),
			};

			const schema = buildValidationSchema(fields);

			expect(() => schema.parse({ website: null })).not.toThrow();
			expect(() => schema.parse({})).not.toThrow();
		});

		it("should apply maxLength to url", () => {
			const fields = {
				website: fi("url", { required: true, maxLength: 20 }),
			};

			const schema = buildValidationSchema(fields);

			expect(() => schema.parse({ website: "https://a.co" })).not.toThrow();
			expect(() =>
				schema.parse({
					website: "https://very-long-domain-name.example.com/path",
				}),
			).toThrow();
		});
	});

	describe("multiSelect fields", () => {
		it("should validate array of values", () => {
			const fields = {
				tags: fi("multiSelect", {
					required: true,
					options: [
						{ label: "A", value: "a" },
						{ label: "B", value: "b" },
						{ label: "C", value: "c" },
					],
				}),
			};

			const schema = buildValidationSchema(fields);

			expect(() => schema.parse({ tags: ["a", "b"] })).not.toThrow();
			expect(() => schema.parse({ tags: ["a"] })).not.toThrow();
			expect(() => schema.parse({ tags: ["invalid"] })).toThrow();
		});

		it("should apply minItems/maxItems constraints", () => {
			const fields = {
				tags: fi("multiSelect", {
					required: true,
					options: [
						{ label: "A", value: "a" },
						{ label: "B", value: "b" },
						{ label: "C", value: "c" },
					],
					minItems: 1,
					maxItems: 2,
				}),
			};

			const schema = buildValidationSchema(fields);

			expect(() => schema.parse({ tags: ["a"] })).not.toThrow();
			expect(() => schema.parse({ tags: ["a", "b"] })).not.toThrow();
			expect(() => schema.parse({ tags: [] })).toThrow();
			expect(() => schema.parse({ tags: ["a", "b", "c"] })).toThrow();
		});

		it("should allow optional multiSelect", () => {
			const fields = {
				tags: fi("multiSelect", {
					options: [{ label: "A", value: "a" }],
				}),
			};

			const schema = buildValidationSchema(fields);

			expect(() => schema.parse({ tags: null })).not.toThrow();
			expect(() => schema.parse({})).not.toThrow();
		});
	});

	describe("upload fields", () => {
		it("should generate schema for single upload", () => {
			const fields = {
				avatar: fi("upload", { required: true }),
			};

			const schema = buildValidationSchema(fields);

			expect(() => schema.parse({ avatar: "asset-123" })).not.toThrow();
			expect(() => schema.parse({})).toThrow();
		});

		it("should generate schema for multiple uploads", () => {
			const fields = {
				gallery: fi("upload", { required: true, multiple: true }),
			};

			const schema = buildValidationSchema(fields);

			expect(() =>
				schema.parse({ gallery: ["asset-1", "asset-2", "asset-3"] }),
			).not.toThrow();

			expect(() => schema.parse({ gallery: [1, 2, 3] })).toThrow();
		});
	});

	describe("createFormSchema", () => {
		it("should create schema with custom validators", () => {
			const fields = {
				password: fi("text", {
					required: true,
					validation: {
						validate: (value: any, _formValues: any) => {
							if (value && value.length < 8) {
								return "Password must be at least 8 characters";
							}
							return undefined;
						},
					},
				}),
			};

			const schema = createFormSchema(fields);

			expect(() => schema.parse({ password: "longpassword123" })).not.toThrow();
			expect(() => schema.parse({ password: "short" })).toThrow();
		});

		it("should support cross-field validation", () => {
			const fields = {
				password: fi("text", { required: true }),
				confirmPassword: fi("text", {
					required: true,
					validation: {
						validate: (value: any, formValues: any) => {
							if (value !== formValues.password) {
								return "Passwords must match";
							}
							return undefined;
						},
					},
				}),
			};

			const schema = createFormSchema(fields);

			expect(() =>
				schema.parse({
					password: "secret123",
					confirmPassword: "secret123",
				}),
			).not.toThrow();

			expect(() =>
				schema.parse({
					password: "secret123",
					confirmPassword: "different",
				}),
			).toThrow();
		});
	});

	describe("complex real-world scenarios", () => {
		it("should handle barbershop appointment form", () => {
			const { r } = createNestedRegistry();
			const fields = {
				customerId: fi("relation", {
					required: true,
					targetCollection: "customers",
					type: "single",
				}),
				barberId: fi("relation", {
					required: true,
					targetCollection: "barbers",
					type: "single",
				}),
				services: fi("array", {
					required: true,
					minItems: 1,
					item: () => ({
						serviceId: r.relation({
							required: true,
							targetCollection: "services",
							type: "single",
						}),
						price: r.number({ required: true, min: 0 }),
					}),
				}),
				scheduledAt: fi("datetime", { required: true }),
				notes: fi("textarea", { maxLength: 500 }),
			};

			const schema = buildValidationSchema(fields);

			expect(() =>
				schema.parse({
					customerId: "cust-1",
					barberId: "barber-1",
					services: [
						{ serviceId: "service-1", price: 25 },
						{ serviceId: "service-2", price: 15 },
					],
					scheduledAt: new Date(),
					notes: "Please be on time",
				}),
			).not.toThrow();

			expect(() =>
				schema.parse({
					customerId: "cust-1",
					barberId: "barber-1",
					services: [],
					scheduledAt: new Date(),
				}),
			).toThrow();

			expect(() =>
				schema.parse({
					customerId: "cust-1",
					barberId: "barber-1",
					services: [{ serviceId: "service-1", price: -10 }],
					scheduledAt: new Date(),
				}),
			).toThrow();
		});

		it("should handle working hours configuration", () => {
			const { r } = createNestedRegistry();

			const daySchedule = () => ({
				isOpen: r.boolean({ required: true }),
				openTime: r.text(),
				closeTime: r.text(),
				breaks: r.array({
					item: () => ({
						start: r.text({ required: true }),
						end: r.text({ required: true }),
					}),
				}),
			});

			const fields = {
				workingHours: fi("object", {
					required: true,
					fields: () => ({
						monday: r.object({ fields: daySchedule }),
						tuesday: r.object({ fields: daySchedule }),
						wednesday: r.object({ fields: daySchedule }),
						thursday: r.object({ fields: daySchedule }),
						friday: r.object({ fields: daySchedule }),
						saturday: r.object({ fields: daySchedule }),
						sunday: r.object({ fields: daySchedule }),
					}),
				}),
			};

			const schema = buildValidationSchema(fields);

			expect(() =>
				schema.parse({
					workingHours: {
						monday: {
							isOpen: true,
							openTime: "09:00",
							closeTime: "17:00",
							breaks: [{ start: "12:00", end: "13:00" }],
						},
						tuesday: { isOpen: true, openTime: "09:00", closeTime: "17:00" },
						wednesday: {
							isOpen: true,
							openTime: "09:00",
							closeTime: "17:00",
						},
						thursday: { isOpen: true, openTime: "09:00", closeTime: "17:00" },
						friday: { isOpen: true, openTime: "09:00", closeTime: "17:00" },
						saturday: { isOpen: false },
						sunday: { isOpen: false },
					},
				}),
			).not.toThrow();
		});
	});
});
