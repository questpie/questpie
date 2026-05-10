import { z } from "zod";

import { jsonSchemaCompatibleSchema } from "./zod-json-schema.js";

export const recordSchema = z.record(z.string(), z.unknown());

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

	return filterZodObjectSchema(schema, policy, entityFieldNames(collection));
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
	);
}

function filterZodObjectSchema(
	schema: z.ZodTypeAny | undefined,
	policy: PolicyWithFields,
	knownFields?: string[],
): z.ZodTypeAny {
	if (!schema) return recordSchema;
	if (!(schema instanceof z.ZodObject)) return recordSchema;

	const shape = (schema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape;
	const shouldFilter = hasFieldPolicy(policy) || !!knownFields?.length;
	if (!shouldFilter) return schema;

	const allowed = allowedKeysFor(knownFields ?? Object.keys(shape), policy);
	const nextShape: Record<string, z.ZodTypeAny> = {};
	for (const key of allowed) {
		if (hasOwn(shape, key))
			nextShape[key] = jsonSchemaCompatibleSchema(shape[key]) ?? z.unknown();
	}

	return z.object(nextShape);
}

function entityFieldNames(entity: unknown): string[] | undefined {
	const fields = (entity as { state?: { fields?: unknown } }).state?.fields;
	if (!isRecord(fields)) return undefined;
	return Object.keys(fields);
}
