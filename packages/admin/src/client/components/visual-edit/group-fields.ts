/**
 * Group fields for the Document inspector
 *
 * Pure helper that turns a flat `FieldInstance` map into the
 * grouped structure the Document panel renders. Reads each field's
 * `visualEdit` block (via the standard resolver) plus the legacy
 * `BaseAdminMeta.group` / `order` keys, with `visualEdit` winning
 * when both sources are set.
 *
 * Fields with `visualEdit.hidden === true` (statically) are
 * dropped. Reactive `hidden` handlers are deferred — they're
 * already evaluated on the server via `useReactiveFields`, so the
 * grouping pass leaves them visible and lets the field component
 * itself decide whether to render.
 */

import type { CollectionSchema } from "questpie/client";

import type { FieldInstance } from "../../builder/field/field.js";
import { resolveVisualEditMeta } from "./visual-edit-meta.js";

// ============================================================================
// Types
// ============================================================================

export type DocumentFieldEntry = {
	name: string;
	field: FieldInstance;
};

export type DocumentFieldGroup = {
	/**
	 * Stable group key used for `key` props and i18n lookups. The
	 * implicit "default" group catches every field that didn't
	 * pick one explicitly.
	 */
	key: string;
	fields: DocumentFieldEntry[];
};

export type GroupFieldsForDocumentArgs = {
	fields: Record<string, FieldInstance>;
	schema?: CollectionSchema | undefined;
};

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_DOCUMENT_GROUP_KEY = "default";

// ============================================================================
// Public API
// ============================================================================

/**
 * Group + sort + filter `fields` for the Document inspector body.
 *
 * Stable: the order of groups follows first-seen-wins of the
 * `group` key in the input field map; within a group, fields sort
 * by `order` ascending (ties fall back to first-seen order).
 */
export function groupFieldsForDocument({
	fields,
	schema,
}: GroupFieldsForDocumentArgs): DocumentFieldGroup[] {
	const seenGroupOrder: string[] = [];
	const buckets = new Map<
		string,
		Array<DocumentFieldEntry & { _order: number; _seq: number }>
	>();

	let seq = 0;
	for (const [name, field] of Object.entries(fields)) {
		const fieldSchema = schema?.fields?.[name];
		const visualEdit = resolveVisualEditMeta({
			fieldDef: field,
			fieldSchema: fieldSchema as any,
		});

		// Static-hidden filter only — reactive hidden defers to the
		// field component's own evaluation.
		if (visualEdit?.hidden === true) continue;

		const baseAdmin = (field["~options"] as any)?.admin ?? {};
		const group =
			visualEdit?.group ??
			(typeof baseAdmin.group === "string" ? baseAdmin.group : undefined) ??
			DEFAULT_DOCUMENT_GROUP_KEY;

		const order =
			typeof visualEdit?.order === "number"
				? visualEdit.order
				: typeof baseAdmin.order === "number"
					? baseAdmin.order
					: Number.MAX_SAFE_INTEGER;

		if (!buckets.has(group)) {
			buckets.set(group, []);
			seenGroupOrder.push(group);
		}
		buckets.get(group)!.push({
			name,
			field,
			_order: order,
			_seq: seq,
		});
		seq += 1;
	}

	const result: DocumentFieldGroup[] = [];
	for (const key of seenGroupOrder) {
		const entries = buckets.get(key)!;
		entries.sort((a, b) => {
			if (a._order !== b._order) return a._order - b._order;
			return a._seq - b._seq;
		});
		result.push({
			key,
			fields: entries.map(({ name, field }) => ({ name, field })),
		});
	}
	return result;
}

/**
 * `true` when the resolved grouping has at least one explicit
 * (non-default) group. Useful for the Document inspector to decide
 * whether to render group headers or just a flat list.
 */
export function hasExplicitGroups(groups: DocumentFieldGroup[]): boolean {
	for (const group of groups) {
		if (group.key !== DEFAULT_DOCUMENT_GROUP_KEY) return true;
	}
	return false;
}

/**
 * `true` when at least one field carries an explicit
 * `visualEdit.group` in either the server schema or the client
 * `~options.admin`. The Visual Edit Workspace uses this signal
 * to auto-switch its default Document body from the legacy
 * `AutoFormFields` to the grouped `DocumentInspectorBody`.
 *
 * Only `visualEdit.group` triggers — `BaseAdminMeta.group` does
 * not, because legacy projects may have set it without intending
 * to switch document layout.
 */
export function hasGroupedDocumentMetadata({
	fields,
	schema,
}: GroupFieldsForDocumentArgs): boolean {
	for (const [name, field] of Object.entries(fields)) {
		const fieldSchema = schema?.fields?.[name];
		const visualEdit = resolveVisualEditMeta({
			fieldDef: field,
			fieldSchema: fieldSchema as any,
		});
		if (typeof visualEdit?.group === "string" && visualEdit.group.length > 0) {
			return true;
		}
	}
	return false;
}
