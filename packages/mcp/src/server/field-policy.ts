import { z } from "zod";

import { jsonSchemaCompatibleSchema } from "./zod-json-schema.js";

const SYSTEM_FIELD_NAMES = [
	"id",
	"createdAt",
	"updatedAt",
	"deletedAt",
	"_status",
];

type FieldPolicy = {
	include?: string[];
	exclude?: string[];
};

type PolicyWithFields = {
	fields?: FieldPolicy;
};

type JsonSchemaObject = {
	properties?: Record<string, unknown>;
	required?: string[];
	[key: string]: unknown;
};

const hasOwn = (value: Record<string, unknown>, key: string) =>
	Object.prototype.hasOwnProperty.call(value, key);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const hasFieldPolicy = (policy: PolicyWithFields) =>
	(policy.fields?.include?.length ?? 0) > 0 ||
	(policy.fields?.exclude?.length ?? 0) > 0;

const allowedKeysFor = (
	keys: Iterable<string>,
	policy: PolicyWithFields,
): Set<string> => {
	const initial = policy.fields?.include?.length
		? policy.fields.include
		: Array.from(keys);
	const allowed = new Set(initial);
	for (const key of policy.fields?.exclude ?? []) allowed.delete(key);
	return allowed;
};

export function filterRecordFields<T>(value: T, policy: PolicyWithFields): T {
	if (!hasFieldPolicy(policy) || !isRecord(value)) return value;

	const allowed = allowedKeysFor(Object.keys(value), policy);
	const next: Record<string, unknown> = {};
	for (const key of allowed) {
		if (hasOwn(value, key)) next[key] = value[key];
	}

	return next as T;
}

export function filterCrudResultFields<T>(
	value: T,
	policy: PolicyWithFields,
): T {
	if (!hasFieldPolicy(policy)) return value;

	if (Array.isArray(value)) {
		return value.map((item) => filterCrudResultFields(item, policy)) as T;
	}

	if (!isRecord(value)) return value;

	if (Array.isArray(value.docs)) {
		return {
			...value,
			docs: value.docs.map((doc) => filterRecordFields(doc, policy)),
		} as T;
	}

	if (isRecord(value.data)) {
		return {
			...value,
			data: filterRecordFields(value.data, policy),
		} as T;
	}

	return filterRecordFields(value, policy);
}

export function filterEntitySchemaFields<T extends { fields?: unknown }>(
	schema: T,
	policy: PolicyWithFields,
): T {
	if (!hasFieldPolicy(policy) || !isRecord(schema.fields)) return schema;

	const allowed = allowedKeysFor(Object.keys(schema.fields), policy);
	const fields: Record<string, unknown> = {};
	for (const key of allowed) {
		if (hasOwn(schema.fields, key)) fields[key] = schema.fields[key];
	}

	const next: T & { fields: Record<string, unknown>; validation?: unknown } = {
		...schema,
		fields,
	};
	if (isRecord((schema as { validation?: unknown }).validation)) {
		const validation = (
			schema as unknown as { validation: Record<string, unknown> }
		).validation;
		next.validation = filterValidationSchemas(validation, allowed);
	}

	return next;
}

function filterValidationSchemas(
	validation: Record<string, unknown>,
	allowed: Set<string>,
) {
	const next: Record<string, unknown> = { ...validation };
	for (const [key, schema] of Object.entries(validation)) {
		next[key] = filterJsonSchemaProperties(schema, allowed);
	}
	return next;
}

export function filterJsonSchemaProperties(
	schema: unknown,
	allowed: Set<string>,
): unknown {
	if (!isRecord(schema) || !isRecord(schema.properties)) return schema;

	const jsonSchema = schema as JsonSchemaObject;
	const properties: Record<string, unknown> = {};
	for (const key of allowed) {
		if (hasOwn(jsonSchema.properties!, key)) {
			properties[key] = jsonSchema.properties![key];
		}
	}

	return {
		...jsonSchema,
		properties,
		required: Array.isArray(jsonSchema.required)
			? jsonSchema.required.filter((key) => allowed.has(key))
			: jsonSchema.required,
	};
}

export function createCollectionDataSchema(
	collection: unknown,
	operation: "create" | "update",
	policy: PolicyWithFields,
): z.ZodTypeAny {
	const validation = (collection as { state?: { validation?: unknown } }).state
		?.validation as
		| {
				insertSchema?: z.ZodTypeAny;
				updateSchema?: z.ZodTypeAny;
		  }
		| undefined;

	const schema =
		operation === "create"
			? validation?.insertSchema
			: validation?.updateSchema;

	return filterZodObjectSchema(
		schema,
		policy,
		entityFieldNames(collection),
		entityFieldDefinitions(collection),
	);
}

export function createGlobalDataSchema(
	global: unknown,
	policy: PolicyWithFields,
): z.ZodTypeAny {
	const validation = (global as { state?: { validation?: unknown } }).state
		?.validation as { updateSchema?: z.ZodTypeAny } | undefined;

	return filterZodObjectSchema(
		validation?.updateSchema,
		policy,
		entityFieldNames(global),
		entityFieldDefinitions(global),
	);
}

function filterZodObjectSchema(
	schema: z.ZodTypeAny | undefined,
	policy: PolicyWithFields,
	knownFields?: string[],
	fieldDefinitions?: Record<string, unknown>,
): z.ZodTypeAny {
	if (!schema || !(schema instanceof z.ZodObject)) {
		const allowed = allowedKeysFor(knownFields ?? [], policy);
		return z
			.object(
				Object.fromEntries(
					[...allowed].map((key) => [key, z.unknown().optional()]),
				),
			)
			.strict();
	}

	const shape = (schema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape;
	const shouldFilter = hasFieldPolicy(policy) || !!knownFields?.length;
	if (!shouldFilter) return schema;

	const allowed = allowedKeysFor(knownFields ?? Object.keys(shape), policy);
	const nextShape: Record<string, z.ZodTypeAny> = {};
	for (const key of allowed) {
		if (hasOwn(shape, key))
			nextShape[key] =
				jsonCompatibleFieldSchema(fieldDefinitions?.[key], shape[key]) ??
				z.unknown();
	}

	return z.object(nextShape).strict();
}

function jsonCompatibleFieldSchema(
	fieldDefinition: unknown,
	schema: z.ZodTypeAny,
): z.ZodTypeAny | undefined {
	if (!isRecord(fieldDefinition) || !isRecord(fieldDefinition._state)) {
		return jsonSchemaCompatibleSchema(schema);
	}
	const state = fieldDefinition._state;
	const type = state.type;
	let external: z.ZodTypeAny | undefined;

	if (type === "datetime" || type === "date") {
		const item =
			type === "datetime" ? z.iso.datetime({ offset: true }) : z.iso.date();
		if (state.isArray === true) {
			let arraySchema = z.array(item);
			if (typeof state.minItems === "number") {
				arraySchema = arraySchema.min(state.minItems);
			}
			if (typeof state.maxItems === "number") {
				arraySchema = arraySchema.max(state.maxItems);
			}
			external = arraySchema;
		} else {
			external = item;
		}
	} else if (type === "object" && isRecord(state.nestedFields)) {
		const nestedShape: Record<string, z.ZodTypeAny> = {};
		for (const [key, nestedDefinition] of Object.entries(state.nestedFields)) {
			if (
				!isRecord(nestedDefinition) ||
				typeof nestedDefinition.toZodSchema !== "function"
			) {
				continue;
			}
			const nestedSchema = nestedDefinition.toZodSchema() as z.ZodTypeAny;
			nestedShape[key] =
				jsonCompatibleFieldSchema(nestedDefinition, nestedSchema) ??
				z.unknown();
		}
		external = z.object(nestedShape);
	} else {
		return jsonSchemaCompatibleSchema(schema);
	}

	if (!external) return undefined;
	if (schema.isNullable()) external = external.nullable();
	if (schema.isOptional()) external = external.optional();
	return external;
}

export function entityFieldNames(entity: unknown): string[] | undefined {
	const fields = (entity as { state?: { fields?: unknown } }).state?.fields;
	if (!isRecord(fields)) return undefined;
	return Object.keys(fields);
}

function entityFieldDefinitions(
	entity: unknown,
): Record<string, unknown> | undefined {
	const fieldDefinitions = (
		entity as { state?: { fieldDefinitions?: unknown } }
	).state?.fieldDefinitions;
	return isRecord(fieldDefinitions) ? fieldDefinitions : undefined;
}

export function allowedEntityFieldNames(
	entity: unknown,
	policy: PolicyWithFields,
): string[] {
	const entityFields = entityFieldNames(entity) ?? [];
	const known = policy.fields?.include?.length
		? entityFields
		: [...new Set([...entityFields, ...SYSTEM_FIELD_NAMES])];
	return [...allowedKeysFor(known, policy)];
}

export function allowedEntityRelationNames(
	entity: unknown,
	policy: PolicyWithFields,
): string[] {
	const fields = (entity as { state?: { fields?: unknown } }).state?.fields;
	if (!isRecord(fields)) return [];
	const allowed = new Set(allowedEntityFieldNames(entity, policy));
	return Object.entries(fields)
		.filter(([name, field]) => {
			if (!allowed.has(name) || !isRecord(field)) return false;
			const fieldState = field["_state"];
			const state = isRecord(fieldState) ? fieldState : undefined;
			return state?.type === "relation" || state?.type === "upload";
		})
		.map(([name]) => name);
}
