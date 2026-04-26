/**
 * Visual Edit metadata helpers
 *
 * Pure resolvers that extract a field's `visualEdit` config from
 * the runtime sources the inspector has access to:
 *
 * 1. Server introspection (`schema.fields[name].admin.visualEdit`)
 * 2. Client-side `FieldInstance.~options.admin.visualEdit`
 *
 * Server wins when both are present (introspection is the source
 * of truth). Returns `undefined` when no visualEdit metadata was
 * supplied — callers should fall back to default rendering.
 */

import type { FieldInstance } from "../../builder/field/field.js";

import type {
	VisualEditFieldMeta,
	VisualEditPatchStrategy,
} from "../../../augmentation.js";

export type ResolvedVisualEditMeta = VisualEditFieldMeta;

type FieldSchemaLike = {
	admin?: { visualEdit?: VisualEditFieldMeta };
	metadata?: { type?: string };
} | null | undefined;

type FieldInstanceLike = FieldInstance | undefined;

// ============================================================================
// Lookup
// ============================================================================

/**
 * Pull the `visualEdit` block off whichever source defines one.
 * Server introspection wins; client `~options.admin` is the
 * fallback so projects that haven't enabled introspection still
 * pick up the override.
 */
export function resolveVisualEditMeta(args: {
	fieldDef?: FieldInstanceLike;
	fieldSchema?: FieldSchemaLike;
}): ResolvedVisualEditMeta | undefined {
	const fromSchema = args.fieldSchema?.admin?.visualEdit;
	if (fromSchema) return fromSchema;

	const options = args.fieldDef?.["~options"] as
		| { admin?: { visualEdit?: VisualEditFieldMeta } }
		| undefined;
	return options?.admin?.visualEdit;
}

// ============================================================================
// Defaults
// ============================================================================

/**
 * Field types whose form value alone is NOT enough to update the
 * preview — the iframe needs the loader to re-resolve them. The
 * patcher routes these through `PREVIEW_REFRESH` instead of
 * `PATCH_BATCH`.
 *
 * - `relation` — the form holds ids; the iframe needs joined data.
 * - `upload` — the form holds asset ids; the iframe needs the
 *   resolved file metadata (url, dimensions, alt).
 * - `blocks` — the iframe re-runs `prefetch()` for any block whose
 *   values changed.
 *
 * Plugins or projects can grow this set per-field by setting
 * `visualEdit.patchStrategy: "refresh"` on the field's metadata.
 */
const REFRESH_FIELD_TYPES = new Set<string>(["relation", "upload", "blocks"]);

/**
 * Default patch strategy for a field type. Scalar/object/text
 * fields patch the preview directly; relations/uploads/blocks
 * round-trip through the loader. Computed fields and anything
 * with a server-side `compute` handler also fall back to refresh
 * since the new value is not knowable client-side.
 *
 * Pass either the introspected schema for the field or the
 * client-side `FieldInstance` — whichever is handy.
 */
export function defaultPatchStrategy(args: {
	fieldDef?: FieldInstanceLike;
	fieldSchema?: FieldSchemaLike;
}): VisualEditPatchStrategy {
	const type =
		args.fieldSchema?.metadata?.type ?? args.fieldDef?.name;
	if (type && REFRESH_FIELD_TYPES.has(type)) return "refresh";

	const options = args.fieldDef?.["~options"] as
		| { admin?: { compute?: unknown } }
		| undefined;
	if (options?.admin?.compute) return "refresh";

	return "patch";
}

/**
 * Combine the explicit `visualEdit.patchStrategy` (if set) with
 * the type-driven default. Always returns a concrete strategy.
 */
export function resolvePatchStrategy(args: {
	fieldDef?: FieldInstanceLike;
	fieldSchema?: FieldSchemaLike;
}): VisualEditPatchStrategy {
	const meta = resolveVisualEditMeta(args);
	return meta?.patchStrategy ?? defaultPatchStrategy(args);
}

// ============================================================================
// Strategy map
// ============================================================================

type SchemaLike = {
	fields?: Record<string, FieldSchemaLike>;
};

/**
 * Build a `{ [fieldName]: patchStrategy }` map for every field in
 * the collection. Pure, allocation-only, safe to call on every
 * render — but the patcher memoises the result so it only runs
 * when fields/schema references change.
 *
 * Returned entries always carry a concrete strategy
 * ({@link VisualEditPatchStrategy}), so consumers can default to
 * `"patch"` for unknown keys without re-resolving.
 */
export function buildStrategyMap(args: {
	fields: Record<string, FieldInstanceLike> | undefined;
	schema: SchemaLike | undefined;
}): Record<string, VisualEditPatchStrategy> {
	const result: Record<string, VisualEditPatchStrategy> = {};
	if (!args.fields) return result;

	for (const [name, fieldDef] of Object.entries(args.fields)) {
		const fieldSchema = args.schema?.fields?.[name];
		result[name] = resolvePatchStrategy({ fieldDef, fieldSchema });
	}
	return result;
}
