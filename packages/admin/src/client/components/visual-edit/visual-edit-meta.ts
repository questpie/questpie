/**
 * Visual Edit metadata helpers
 *
 * Pure resolvers that extract a field's `visualEdit` config from
 * the runtime sources the inspector has access to:
 *
 * 1. Server introspection — `schema.fields[name].metadata.meta.admin.visualEdit`
 *    (the introspection pipe stashes the field's admin extensions
 *    under `metadata.meta`; see
 *    `packages/admin/src/client/utils/build-field-definitions-from-schema.ts`
 *    for the canonical read path).
 * 2. Client-side `FieldInstance.~options.admin.visualEdit`.
 *
 * For nested object fields, the resolver walks
 * `metadata.nestedFields[…]` so a deep override (e.g. on
 * `meta.seo.title`) wins over a shallower ancestor's override.
 *
 * Server introspection wins over client-side options when both
 * are present at the same depth. Returns `undefined` when no
 * visualEdit metadata was supplied — callers should fall back to
 * default rendering.
 */

import type { FieldInstance } from "../../builder/field/field.js";

import type {
	VisualEditFieldMeta,
	VisualEditPatchStrategy,
} from "../../../augmentation.js";

export type ResolvedVisualEditMeta = VisualEditFieldMeta;

/**
 * Loose shape mirroring `FieldMetadata` (server introspection,
 * nested level). Nested fields under `nestedFields` are recorded
 * at the metadata level — they don't go through `FieldSchema`
 * again — so the walker reads/descends through this shape.
 */
type FieldMetadataLike =
	| {
			type?: string;
			meta?: { admin?: { visualEdit?: VisualEditFieldMeta } };
			nestedFields?: Record<string, FieldMetadataLike>;
	  }
	| null
	| undefined;

/**
 * Loose shape mirroring `FieldSchema` (server introspection,
 * top level): wraps `FieldMetadataLike` under `metadata`.
 */
type FieldSchemaLike =
	| {
			metadata?: FieldMetadataLike;
	  }
	| null
	| undefined;

type FieldInstanceLike = FieldInstance | undefined;

// ============================================================================
// Visual edit lookup
// ============================================================================

/**
 * Read the `visualEdit` block from a single FieldSchema (no
 * descent). Server introspection wins over client `~options`.
 */
export function resolveVisualEditMeta(args: {
	fieldDef?: FieldInstanceLike;
	fieldSchema?: FieldSchemaLike;
}): ResolvedVisualEditMeta | undefined {
	const fromSchema =
		args.fieldSchema?.metadata?.meta?.admin?.visualEdit;
	if (fromSchema) return fromSchema;

	const options = args.fieldDef?.["~options"] as
		| { admin?: { visualEdit?: VisualEditFieldMeta } }
		| undefined;
	return options?.admin?.visualEdit;
}

/**
 * Walk an object/array field's `metadata.nestedFields` along a
 * dot-notation `path` and return the deepest `visualEdit` block
 * found. Numeric segments (array indices) halt the descent —
 * arrays expose their items shape under a different key, so
 * descending past an index is unsafe.
 *
 * Falls back to the top-level field's `visualEdit` when no
 * deeper override is present.
 *
 * @param fieldDef    — top-level FieldInstance (used as fallback
 *                      source for `visualEdit` when the schema
 *                      provides nothing)
 * @param fieldSchema — schema for the same top-level field
 * @param relativePath — path *under* the top-level field
 *                       (`""` for the field root, `"seo.title"`
 *                       for a deep path inside `meta`)
 */
export function resolveNestedVisualEditMeta(args: {
	fieldDef?: FieldInstanceLike;
	fieldSchema?: FieldSchemaLike;
	relativePath?: string;
}): ResolvedVisualEditMeta | undefined {
	let deepest = resolveVisualEditMeta({
		fieldDef: args.fieldDef,
		fieldSchema: args.fieldSchema,
	});

	const segments = (args.relativePath ?? "")
		.split(".")
		.filter((s) => s.length > 0);
	if (segments.length === 0) return deepest;

	// Top level reads .metadata; subsequent levels are
	// FieldMetadataLike themselves (no .metadata wrapping).
	let cursor: FieldMetadataLike | undefined = args.fieldSchema?.metadata;
	for (const segment of segments) {
		if (/^\d+$/.test(segment)) break;
		const nested = cursor?.nestedFields?.[segment];
		if (!nested) break;
		cursor = nested;
		const nextMeta = nested?.meta?.admin?.visualEdit;
		if (nextMeta) deepest = nextMeta;
	}
	return deepest;
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
	const type = args.fieldSchema?.metadata?.type ?? args.fieldDef?.name;
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
