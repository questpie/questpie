import { z } from "zod";

type FieldDefinitionLike = {
	toZodSchema?: () => unknown;
	_state?: {
		type?: unknown;
		input?: unknown;
		output?: unknown;
		notNull?: unknown;
		isArray?: unknown;
		minItems?: unknown;
		maxItems?: unknown;
		localized?: unknown;
		nestedFields?: Record<string, unknown>;
	};
};

export function buildFieldDefinitionSchemas(fieldDefinitions: unknown): {
	insert: unknown;
	update: unknown;
	response: unknown;
} | null {
	if (!fieldDefinitions || typeof fieldDefinitions !== "object") {
		return null;
	}

	const inputShape: Record<string, z.ZodTypeAny> = {};
	const responseShape: Record<string, z.ZodTypeAny> = {};

	for (const [fieldName, fieldDefinition] of Object.entries(
		fieldDefinitions as Record<string, unknown>,
	)) {
		const fd = fieldDefinition as FieldDefinitionLike;
		if (typeof fd.toZodSchema !== "function") {
			continue;
		}

		try {
			const schema = fd.toZodSchema();
			if (!schema || typeof schema !== "object" || !("_def" in schema)) {
				continue;
			}

			if (fd._state?.input !== false) {
				inputShape[fieldName] = schema as z.ZodTypeAny;
			}
			if (fd._state?.output !== false) {
				responseShape[fieldName] = schema as z.ZodTypeAny;
			}
		} catch {
			// Ignore fields that cannot be converted; keep generating the rest.
		}
	}

	if (
		Object.keys(inputShape).length === 0 &&
		Object.keys(responseShape).length === 0
	) {
		return null;
	}

	const insertJsonSchema = z.toJSONSchema(z.object(inputShape), {
		unrepresentable: "any",
	});
	const updateJsonSchema = z.toJSONSchema(z.object(inputShape).partial(), {
		unrepresentable: "any",
	});
	const responseJsonSchema = z.toJSONSchema(z.object(responseShape), {
		unrepresentable: "any",
	});

	applyRequestFieldFlags(insertJsonSchema, fieldDefinitions);
	applyRequestFieldFlags(updateJsonSchema, fieldDefinitions);
	applyResponseFieldFlags(responseJsonSchema, fieldDefinitions);

	return {
		insert: insertJsonSchema,
		update: updateJsonSchema,
		response: responseJsonSchema,
	};
}

export function applyRequestFieldFlags(
	schema: unknown,
	fieldDefinitions: unknown,
): void {
	applyFieldFlags(schema, fieldDefinitions, "request");
}

function applyResponseFieldFlags(
	schema: unknown,
	fieldDefinitions: unknown,
): void {
	applyFieldFlags(schema, fieldDefinitions, "response");
}

function applyFieldFlags(
	schema: unknown,
	fieldDefinitions: unknown,
	mode: "request" | "response",
): void {
	if (!schema || typeof schema !== "object") return;
	if (!fieldDefinitions || typeof fieldDefinitions !== "object") return;

	for (const [fieldName, fieldDefinition] of Object.entries(
		fieldDefinitions as Record<string, unknown>,
	)) {
		const state = (fieldDefinition as FieldDefinitionLike)._state;
		if (!state) continue;

		if (mode === "request" && state.input === false) {
			removeProperty(schema, fieldName);
			continue;
		}
		if (mode === "response" && state.output === false) {
			removeProperty(schema, fieldName);
			continue;
		}

		if (mode === "request" && state.output === false) {
			markProperty(schema, fieldName, "writeOnly");
		}
		if (mode === "response" && state.input === false) {
			markProperty(schema, fieldName, "readOnly");
		}

		for (const propertySchema of getPropertySchemas(schema, fieldName)) {
			applyTemporalFieldSchema(propertySchema, state);
			if (state.nestedFields) {
				applyFieldFlags(propertySchema, state.nestedFields, mode);
			}
		}
	}
}

function applyTemporalFieldSchema(
	schema: unknown,
	state: NonNullable<FieldDefinitionLike["_state"]>,
): void {
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
	const format =
		state.type === "datetime"
			? "date-time"
			: state.type === "date"
				? "date"
				: null;
	if (!format) return;

	const target = schema as Record<string, unknown>;
	const retained = Object.fromEntries(
		Object.entries(target).filter(
			([key]) =>
				key === "title" ||
				key === "description" ||
				key === "default" ||
				key === "examples" ||
				key === "deprecated" ||
				key === "readOnly" ||
				key === "writeOnly" ||
				key.startsWith("x-") ||
				(state.isArray === true &&
					(key === "minItems" || key === "maxItems" || key === "uniqueItems")),
		),
	);
	for (const key of Object.keys(target)) delete target[key];
	Object.assign(target, retained);
	if (state.isArray === true) {
		target.type = state.notNull === true ? "array" : ["array", "null"];
		target.items = { type: "string", format };
		if (typeof state.minItems === "number") target.minItems = state.minItems;
		if (typeof state.maxItems === "number") target.maxItems = state.maxItems;
	} else {
		target.type = state.notNull === true ? "string" : ["string", "null"];
		target.format = format;
	}
}

function schemaObjectsWithProperties(
	schema: unknown,
	seen = new Set<object>(),
): Array<{ properties: Record<string, unknown>; required?: unknown }> {
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
	if (seen.has(schema)) return [];
	seen.add(schema);

	const object = schema as Record<string, unknown>;
	const containers: Array<{
		properties: Record<string, unknown>;
		required?: unknown;
	}> = [];
	if (
		object.properties &&
		typeof object.properties === "object" &&
		!Array.isArray(object.properties)
	) {
		containers.push(
			object as {
				properties: Record<string, unknown>;
				required?: unknown;
			},
		);
	}
	for (const keyword of ["anyOf", "oneOf", "allOf"] as const) {
		const branches = object[keyword];
		if (!Array.isArray(branches)) continue;
		for (const branch of branches) {
			containers.push(...schemaObjectsWithProperties(branch, seen));
		}
	}
	return containers;
}

function getPropertySchemas(schema: unknown, fieldName: string): unknown[] {
	return schemaObjectsWithProperties(schema)
		.map(({ properties }) => properties[fieldName])
		.filter((property) => property !== undefined);
}

function removeProperty(schema: unknown, fieldName: string): void {
	for (const schemaObject of schemaObjectsWithProperties(schema)) {
		if (!schemaObject.properties[fieldName]) continue;
		delete schemaObject.properties[fieldName];
		if (Array.isArray(schemaObject.required)) {
			schemaObject.required = schemaObject.required.filter(
				(field) => field !== fieldName,
			);
		}
	}
}

function markProperty(
	schema: unknown,
	fieldName: string,
	flag: "readOnly" | "writeOnly",
): void {
	for (const { properties } of schemaObjectsWithProperties(schema)) {
		if (!properties[fieldName] || typeof properties[fieldName] !== "object")
			continue;
		(properties[fieldName] as Record<string, unknown>)[flag] = true;
	}
}
