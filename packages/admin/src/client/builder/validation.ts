/**
 * Client-side Validation Schema Builder
 *
 * Centralized Zod schema generation from server field metadata.
 * Server JSON Schema + AJV is the primary validation; this is the Zod fallback
 * used for react-hook-form integration.
 *
 * Three resolution tiers:
 * 1. FIELD_VALIDATORS registry (10 special-case field types)
 * 2. Generic: resolveBaseType() + applyConstraints() (simple field types)
 */

import { z } from "zod";

import type { FieldInstance } from "./field/field";
import type { FieldValidationConfig } from "./types/field-types";

// ============================================================================
// Types
// ============================================================================

type FieldsMap = Record<string, FieldInstance>;

interface BuildContext {
	buildSchema: (fieldDef: FieldInstance) => z.ZodTypeAny;
}

// ============================================================================
// Helpers
// ============================================================================

function wrapOptional(schema: z.ZodTypeAny, required?: boolean): z.ZodTypeAny {
	if (required) return schema;
	return schema.optional().nullable();
}

// ============================================================================
// Special-Case Field Validators (Tier 1)
// ============================================================================

const FIELD_VALIDATORS: Record<
	string,
	(opts: Record<string, any>, ctx: BuildContext) => z.ZodTypeAny
> = {
	email: (opts) => {
		let schema = z.email("Invalid email address");
		if (opts.maxLength) {
			schema = schema.max(
				opts.maxLength,
				`Must be at most ${opts.maxLength} characters`,
			);
		}
		return wrapOptional(schema, opts.required);
	},

	url: (opts) => {
		let schema = z.url("Invalid URL");
		if (opts.maxLength) {
			schema = schema.max(
				opts.maxLength,
				`Must be at most ${opts.maxLength} characters`,
			);
		}
		return wrapOptional(schema, opts.required);
	},

	select: (opts) => {
		if (opts.options && opts.options.length > 0) {
			const validValues = new Set(opts.options.map((o: any) => o.value));
			const schema = z
				.union([z.string(), z.number()])
				.refine((val) => validValues.has(val), {
					message: "Invalid selection",
				});
			return wrapOptional(schema, opts.required);
		}
		return wrapOptional(z.union([z.string(), z.number()]), opts.required);
	},

	multiSelect: (opts) => {
		const validValues =
			opts.options?.length > 0
				? new Set(opts.options.map((o: any) => o.value))
				: null;
		const itemSchema = validValues
			? z
					.union([z.string(), z.number()])
					.refine((val) => validValues.has(val), {
						message: "Invalid selection",
					})
			: z.union([z.string(), z.number()]);

		let schema = z.array(itemSchema);
		if (opts.minItems !== undefined) {
			schema = schema.min(
				opts.minItems,
				`Minimum ${opts.minItems} items required`,
			);
		}
		if (opts.maxItems !== undefined) {
			schema = schema.max(
				opts.maxItems,
				`Maximum ${opts.maxItems} items allowed`,
			);
		}
		return wrapOptional(schema, opts.required);
	},

	date: (opts) => {
		const schema = z
			.union([z.date(), z.string().datetime()])
			.transform((val) => (typeof val === "string" ? new Date(val) : val));
		return wrapOptional(schema, opts.required);
	},

	datetime: (opts) => {
		const schema = z
			.union([z.date(), z.string().datetime()])
			.transform((val) => (typeof val === "string" ? new Date(val) : val));
		return wrapOptional(schema, opts.required);
	},

	time: (opts) => {
		const schema = z
			.string()
			.regex(
				/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/,
				"Invalid time format",
			);
		return wrapOptional(schema, opts.required);
	},

	relation: (opts) => {
		if (opts.type === "multiple") {
			let schema = z.array(z.string());
			if (opts.maxItems) {
				schema = schema.max(
					opts.maxItems,
					`Maximum ${opts.maxItems} items allowed`,
				);
			}
			return wrapOptional(schema, opts.required);
		}
		return wrapOptional(z.string(), opts.required);
	},

	upload: (opts) => {
		if (opts.multiple) {
			let schema = z.array(z.string());
			if (opts.maxItems) {
				schema = schema.max(
					opts.maxItems,
					`Maximum ${opts.maxItems} files allowed`,
				);
			}
			return wrapOptional(schema, opts.required);
		}
		return wrapOptional(z.string(), opts.required);
	},

	object: (opts, ctx) => {
		if (!opts.fields) {
			return wrapOptional(z.record(z.string(), z.any()), opts.required);
		}
		const nestedFields =
			typeof opts.fields === "function" ? opts.fields({}) : opts.fields;
		const shape: Record<string, z.ZodTypeAny> = {};
		for (const [name, fieldDef] of Object.entries(
			nestedFields as Record<string, any>,
		)) {
			shape[name] = ctx.buildSchema(fieldDef);
		}
		return wrapOptional(z.object(shape), opts.required);
	},

	array: (opts, ctx) => {
		let itemSchema: z.ZodTypeAny;

		if (opts.item) {
			const itemFields =
				typeof opts.item === "function" ? opts.item({}) : opts.item;
			const shape: Record<string, z.ZodTypeAny> = {};
			for (const [name, fieldDef] of Object.entries(
				itemFields as Record<string, any>,
			)) {
				shape[name] = ctx.buildSchema(fieldDef);
			}
			itemSchema = z.object(shape);
		} else {
			switch (opts.itemType) {
				case "text":
				case "textarea":
					itemSchema = z.string();
					break;
				case "number":
					itemSchema = z.number();
					break;
				case "email":
					itemSchema = z.string().email("Invalid email");
					break;
				case "select":
					if (opts.options?.length > 0) {
						const validVals = new Set(opts.options.map((o: any) => o.value));
						itemSchema = z
							.union([z.string(), z.number()])
							.refine((val) => validVals.has(val), {
								message: "Invalid selection",
							});
					} else {
						itemSchema = z.union([z.string(), z.number()]);
					}
					break;
				default:
					itemSchema = z.any();
			}
		}

		let schema = z.array(itemSchema);
		if (opts.minItems !== undefined) {
			schema = schema.min(
				opts.minItems,
				`Minimum ${opts.minItems} items required`,
			);
		}
		if (opts.maxItems !== undefined) {
			schema = schema.max(
				opts.maxItems,
				`Maximum ${opts.maxItems} items allowed`,
			);
		}
		return wrapOptional(schema, opts.required);
	},

	blocks: (opts) => {
		const blockNodeSchema: z.ZodType<any> = z.lazy(() =>
			z.object({
				id: z.string(),
				type: z.string(),
				children: z.array(blockNodeSchema),
			}),
		);

		let schema = z.object({
			_tree: z.array(blockNodeSchema),
			_values: z.record(z.string(), z.record(z.string(), z.any())),
		});

		if (opts.minBlocks !== undefined || opts.maxBlocks !== undefined) {
			schema = schema.refine(
				(data) => {
					const count = countBlocks(data._tree);
					if (opts.minBlocks !== undefined && count < opts.minBlocks)
						return false;
					if (opts.maxBlocks !== undefined && count > opts.maxBlocks)
						return false;
					return true;
				},
				{
					message:
						opts.minBlocks !== undefined && opts.maxBlocks !== undefined
							? `Must have between ${opts.minBlocks} and ${opts.maxBlocks} blocks`
							: opts.minBlocks !== undefined
								? `Minimum ${opts.minBlocks} blocks required`
								: `Maximum ${opts.maxBlocks} blocks allowed`,
				},
			) as any;
		}

		return wrapOptional(schema, opts.required);
	},
};

function countBlocks(tree: Array<{ children: Array<any> }>): number {
	let count = 0;
	for (const node of tree) {
		count += 1;
		count += countBlocks(node.children);
	}
	return count;
}

// ============================================================================
// Generic Type Resolution (Tier 2)
// ============================================================================

function resolveBaseType(fieldType: string): z.ZodTypeAny {
	switch (fieldType) {
		case "text":
		case "textarea":
			return z.string();
		case "number":
			return z.number();
		case "boolean":
			return z.boolean();
		case "json":
		case "richText":
		case "assetPreview":
			return z.any();
		default:
			return z.any();
	}
}

function applyConstraints(
	schema: z.ZodTypeAny,
	opts: Record<string, any>,
): z.ZodTypeAny {
	if (schema instanceof z.ZodString) {
		let s = schema;
		if (opts.minLength) {
			s = s.min(
				opts.minLength,
				`Must be at least ${opts.minLength} characters`,
			);
		}
		if (opts.maxLength) {
			s = s.max(opts.maxLength, `Must be at most ${opts.maxLength} characters`);
		}
		if (opts.pattern) {
			const regex =
				typeof opts.pattern === "string"
					? new RegExp(opts.pattern)
					: opts.pattern;
			s = s.regex(regex, "Invalid format");
		}
		return s;
	}

	if (schema instanceof z.ZodNumber) {
		let n = schema;
		if (opts.min !== undefined) {
			n = n.min(opts.min, `Must be at least ${opts.min}`);
		}
		if (opts.max !== undefined) {
			n = n.max(opts.max, `Must be at most ${opts.max}`);
		}
		return n;
	}

	return schema;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Build a Zod schema from a single field's metadata.
 *
 * Resolution order:
 * 1. FIELD_VALIDATORS[type] — special-case fields (email, select, date, relation, etc.)
 * 2. Generic — resolveBaseType() + applyConstraints() (text, number, boolean, etc.)
 */
export function buildZodFromIntrospection(
	fieldDef: FieldInstance,
	ctx: BuildContext,
): z.ZodTypeAny {
	const opts = (fieldDef["~options"] || {}) as Record<string, any>;

	// Tier 1: Special-case validator
	const validator = FIELD_VALIDATORS[fieldDef.name];
	if (validator) {
		return validator(opts, ctx);
	}

	// Tier 2: Generic type + constraints
	const base = resolveBaseType(fieldDef.name);
	const constrained = applyConstraints(base, opts);
	return wrapOptional(constrained, opts.required);
}

/**
 * Build a Zod object schema from a map of field instances.
 */
export function buildValidationSchema(
	fields: FieldsMap,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
	const ctx: BuildContext = {
		buildSchema: (fieldDef) => buildZodFromIntrospection(fieldDef, ctx),
	};

	const shape: Record<string, z.ZodTypeAny> = {};
	for (const [name, fieldDef] of Object.entries(fields)) {
		shape[name] = ctx.buildSchema(fieldDef);
	}
	return z.object(shape);
}

/**
 * Build validation schema with custom cross-field validators.
 */
function buildValidationSchemaWithCustom(fields: FieldsMap): z.ZodTypeAny {
	const baseSchema = buildValidationSchema(fields);

	const customValidators: Array<{
		name: string;
		validate: NonNullable<FieldValidationConfig["validate"]>;
	}> = [];

	for (const [name, fieldDef] of Object.entries(fields)) {
		const options = (fieldDef["~options"] || {}) as Record<string, any>;
		if (options.validation?.validate) {
			customValidators.push({
				name,
				validate: options.validation.validate,
			});
		}
	}

	if (customValidators.length === 0) {
		return baseSchema;
	}

	return baseSchema.superRefine((data, ctx) => {
		for (const { name, validate } of customValidators) {
			const error = validate(data[name], data);
			if (error) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: error,
					path: [name],
				});
			}
		}
	});
}

/**
 * Create a Zod validation schema from admin field config.
 *
 * @example
 * ```tsx
 * const schema = createFormSchema(fieldInstances);
 * const form = useForm({ resolver: zodResolver(schema) });
 * ```
 */
export function createFormSchema(fields: FieldsMap): z.ZodTypeAny {
	return buildValidationSchemaWithCustom(fields);
}
