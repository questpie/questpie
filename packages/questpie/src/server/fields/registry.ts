/**
 * Field Registry
 *
 * Registry for field types. Allows registration of built-in and custom fields.
 * The registry maps field type names to plain field definition objects (FieldDef).
 */

import type { FieldDef } from "./define-field.js";
import type { BaseFieldConfig } from "./types.js";

// ============================================================================
// Any Field Def Type (for registry storage)
// ============================================================================

/**
 * Generic field def type for registry storage.
 * Uses FieldDef<any, any> as the widened storage type.
 */
export type AnyFieldDef = FieldDef<any, any>;

// ============================================================================
// Field Registry
// ============================================================================

/**
 * Registry for field types.
 * Allows registration of built-in and custom fields.
 * Stores plain field definition objects (from defineField).
//  * TODO: Consider replacing FieldRegistry class with plain exported builtinFields (like admin package)
 */
export class FieldRegistry {
	/** Registered field definitions */
	private fields: Map<string, AnyFieldDef> = new Map();

	/**
	 * Register a field type.
	 *
	 * @param type - The field type identifier (e.g., "text", "number")
	 * @param fieldDef - Plain field definition object (from defineField)
	 * @returns this (for chaining)
	 *
	 * @example
	 * ```ts
	 * registry.register("text", textField);
	 * registry.register("number", numberField);
	 * ```
	 */
	register<TType extends string>(
		type: TType,
		fieldDef: FieldDef<BaseFieldConfig, any>,
	): this {
		this.fields.set(type, fieldDef as AnyFieldDef);
		return this;
	}

	/**
	 * Get field definition by type.
	 *
	 * @param type - The field type identifier
	 * @returns The field definition or undefined if not registered
	 *
	 * @example
	 * ```ts
	 * const textDef = registry.get("text");
	 * if (textDef) {
	 *   const field = createFieldDefinition(textDef, { required: true });
	 * }
	 * ```
	 */
	get<TType extends string>(type: TType): AnyFieldDef | undefined {
		return this.fields.get(type);
	}

	/**
	 * Check if field type is registered.
	 *
	 * @param type - The field type identifier
	 * @returns true if the type is registered
	 */
	has(type: string): boolean {
		return this.fields.has(type);
	}

	/**
	 * Get all registered field types.
	 *
	 * @returns Array of registered type names
	 */
	types(): string[] {
		return Array.from(this.fields.keys());
	}

	/**
	 * Get the number of registered field types.
	 */
	get size(): number {
		return this.fields.size;
	}

	/**
	 * Create a shallow copy of this registry.
	 * Useful for extending built-in registry with custom fields.
	 *
	 * @returns New registry with same field registrations
	 */
	clone(): FieldRegistry {
		const newRegistry = new FieldRegistry();
		for (const [type, fieldDef] of this.fields) {
			newRegistry.fields.set(type, fieldDef);
		}
		return newRegistry;
	}
}

/**
 * Default global registry instance.
 * Built-in fields are registered here during module initialization.
 */
let defaultRegistry: FieldRegistry | null = null;

/**
 * Get the default field registry.
 * Creates it if it doesn't exist yet.
 *
 * @returns The default field registry instance
 */
export function getDefaultRegistry(): FieldRegistry {
	if (!defaultRegistry) {
		defaultRegistry = new FieldRegistry();
	}
	return defaultRegistry;
}

/**
 * Create a new field registry.
 * Use this when you need isolated registries (e.g., for testing).
 *
 * @returns A new empty field registry
 */
export function createFieldRegistry(): FieldRegistry {
	return new FieldRegistry();
}
