import { z } from "zod";

type FieldDefinitionLike = {
	toZodSchema?: () => unknown;
	_state?: {
		input?: unknown;
		output?: unknown;
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

		const propertySchema = getProperty(schema, fieldName);
		if (propertySchema && state.nestedFields) {
			applyFieldFlags(propertySchema, state.nestedFields, mode);
		}
	}
}

function getProperty(schema: unknown, fieldName: string): unknown {
	if (!schema || typeof schema !== "object") return undefined;

	const properties = (schema as { properties?: Record<string, unknown> })
		.properties;
	return properties?.[fieldName];
}

function removeProperty(schema: unknown, fieldName: string): void {
	if (!schema || typeof schema !== "object") return;

	const schemaObject = schema as {
		properties?: Record<string, unknown>;
		required?: unknown;
	};
	if (!schemaObject.properties?.[fieldName]) return;

	delete schemaObject.properties[fieldName];
	if (Array.isArray(schemaObject.required)) {
		schemaObject.required = schemaObject.required.filter(
			(field) => field !== fieldName,
		);
	}
}

function markProperty(
	schema: unknown,
	fieldName: string,
	flag: "readOnly" | "writeOnly",
): void {
	if (!schema || typeof schema !== "object") return;

	const properties = (schema as { properties?: Record<string, unknown> })
		.properties;
	if (!properties?.[fieldName] || typeof properties[fieldName] !== "object")
		return;

	properties[fieldName] = {
		...(properties[fieldName] as Record<string, unknown>),
		[flag]: true,
	};
}
