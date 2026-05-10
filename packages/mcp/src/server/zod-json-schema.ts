import { z } from "zod";

export function jsonSchemaCompatibleSchema(
	schema: z.ZodTypeAny | undefined,
): z.ZodTypeAny | undefined {
	if (!schema) return undefined;
	if (canConvertToJsonSchema(schema)) return schema;

	const def = (schema as { _def?: Record<string, any> })._def;
	switch (def?.type) {
		case "date":
			return z.string().describe("ISO date or date-time string");
		case "optional":
			return (
				jsonSchemaCompatibleSchema(def.innerType)?.optional() ?? z.unknown()
			);
		case "nullable":
			return (
				jsonSchemaCompatibleSchema(def.innerType)?.nullable() ?? z.unknown()
			);
		case "default":
		case "prefault":
		case "catch":
			return (
				jsonSchemaCompatibleSchema(def.innerType)?.optional() ?? z.unknown()
			);
		case "array":
			return z.array(jsonSchemaCompatibleSchema(def.element) ?? z.unknown());
		case "record": {
			const keySchema = jsonSchemaCompatibleSchema(def.keyType);
			return z.record(
				keySchema instanceof z.ZodString ? keySchema : z.string(),
				jsonSchemaCompatibleSchema(def.valueType) ?? z.unknown(),
			);
		}
		case "union": {
			const options = Array.isArray(def.options)
				? def.options.map(
						(option) => jsonSchemaCompatibleSchema(option) ?? z.unknown(),
					)
				: [];
			if (options.length === 0) return z.unknown();
			if (options.length === 1) return options[0];
			return z.union(
				options as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]],
			);
		}
		case "object": {
			const shape = (schema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape;
			const nextShape: Record<string, z.ZodTypeAny> = {};
			for (const [key, value] of Object.entries(shape)) {
				nextShape[key] = jsonSchemaCompatibleSchema(value) ?? z.unknown();
			}
			const objectSchema = z.object(nextShape);
			if (def.catchall && def.catchall._def?.type !== "never") {
				return objectSchema.catchall(
					jsonSchemaCompatibleSchema(def.catchall) ?? z.unknown(),
				);
			}
			return objectSchema;
		}
		default:
			return z.unknown();
	}
}

export function toJsonSchema(schema: z.ZodTypeAny | undefined) {
	const compatible = jsonSchemaCompatibleSchema(schema);
	if (!compatible) return undefined;

	try {
		return z.toJSONSchema(compatible);
	} catch {
		return undefined;
	}
}

function canConvertToJsonSchema(schema: z.ZodTypeAny): boolean {
	try {
		z.toJSONSchema(schema);
		return true;
	} catch {
		return false;
	}
}
