/**
 * DocumentInspectorBody
 *
 * Building block for the Visual Edit Workspace's idle inspector
 * mode. Renders the active collection's fields grouped by their
 * `visualEdit.group` (falling back to `BaseAdminMeta.group`),
 * filtered by `visualEdit.hidden`, and sorted by
 * `visualEdit.order`.
 *
 * Falls back to a flat list when no field opts into grouping —
 * matches today's `AutoFormFields` shape closely enough that
 * projects can swap this in without a layout regression.
 *
 * `VisualEditFormHost` auto-selects this component as the default
 * `renderDocument` when at least one field declares
 * `visualEdit.group` (see `hasGroupedDocumentMetadata`). When no
 * field opts in, the host keeps `AutoFormFields` so existing
 * sections / tabs carry over untouched. Consumers can also pass
 * `renderDocument` explicitly to force this body unconditionally.
 */

"use client";

import * as React from "react";

import type { ComponentRegistry } from "../../builder/index.js";
import { useTranslation } from "../../i18n/hooks.js";
import { cn } from "../../lib/utils.js";
import { FieldRenderer } from "../../views/collection/field-renderer.js";
import { Spinner } from "../ui/spinner.js";
import {
	type DocumentFieldGroup,
	DEFAULT_DOCUMENT_GROUP_KEY,
	groupFieldsForDocument,
	hasExplicitGroups,
} from "./group-fields.js";
import { useVisualEditController } from "./visual-edit-form-host.js";

// ============================================================================
// Props
// ============================================================================

export type DocumentInspectorBodyProps = {
	/**
	 * Collection name passed through to `FieldRenderer`. Defaults
	 * to the active controller's collection — only override when
	 * embedding the body in a non-standard layout.
	 */
	collection?: string;
	/** Optional registry override forwarded to `FieldRenderer`. */
	registry?: ComponentRegistry;
	/** Other collections' configs — needed for embedded fields. */
	allCollectionsConfig?: Record<string, unknown>;
	/**
	 * Render the group label for a group key. Defaults to a simple
	 * humanised version of the key. Override when you want i18n
	 * via `useTranslation` or a fully custom header.
	 */
	renderGroupLabel?: (groupKey: string) => React.ReactNode;
	/** Custom class name applied to the root container. */
	className?: string;
};

// ============================================================================
// Component
// ============================================================================

export function DocumentInspectorBody({
	collection: collectionProp,
	registry,
	allCollectionsConfig,
	renderGroupLabel,
	className,
}: DocumentInspectorBodyProps) {
	const controller = useVisualEditController();
	const { t } = useTranslation();

	const groups = React.useMemo(
		() =>
			groupFieldsForDocument({
				fields: controller.fields,
				schema: controller.schema,
			}),
		[controller.fields, controller.schema],
	);

	// Distinguish "still loading" from "no fields to display" so the
	// inspector doesn't flash a misleading empty-state during initial
	// schema fetch.
	if (controller.isFieldsLoading && groups.length === 0) {
		return (
			<div className="flex items-center justify-center py-8">
				<Spinner className="size-5" />
			</div>
		);
	}

	if (groups.length === 0) {
		return (
			<div className="text-muted-foreground py-6 text-center text-xs">
				{t("preview.documentNoFields", {
					defaultValue: "No fields to display.",
				})}
			</div>
		);
	}

	const showGroupHeaders = hasExplicitGroups(groups);
	const collection = collectionProp ?? controller.collection;

	const labelFor = (group: DocumentFieldGroup) => {
		if (renderGroupLabel) return renderGroupLabel(group.key);
		if (group.key === DEFAULT_DOCUMENT_GROUP_KEY) return null;
		return humaniseGroupKey(group.key);
	};

	return (
		<div className={cn("space-y-6", className)}>
			{groups.map((group) => {
				const label = showGroupHeaders ? labelFor(group) : null;
				return (
					<section key={group.key} className="space-y-3">
						{label && (
							<header className="text-foreground text-xs font-semibold tracking-wide uppercase">
								{label}
							</header>
						)}
						<div className="space-y-4">
							{group.fields.map(({ name, field }) => (
								<FieldRenderer
									key={`${group.key}:${name}`}
									fieldName={name}
									fieldDef={field}
									collection={collection ?? ""}
									registry={registry}
									allCollectionsConfig={allCollectionsConfig as any}
								/>
							))}
						</div>
					</section>
				);
			})}
		</div>
	);
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Lightweight humanisation: kebab-case / snake_case → Title Case.
 * Used as the default group label when consumers don't override
 * `renderGroupLabel`.
 */
function humaniseGroupKey(key: string): string {
	return key
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.split(" ")
		.map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
		.join(" ");
}
