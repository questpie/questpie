/**
 * Block Type Icon
 *
 * Displays the icon for a block type using component references.
 */

"use client";

import * as React from "react";
import type { ComponentReference } from "#questpie/admin/server";
import { ComponentRenderer } from "../../components/component-renderer";
import { cn } from "../../lib/utils.js";
import { useBlockDefinition } from "./block-editor-context.js";

// ============================================================================
// Types
// ============================================================================

export type BlockTypeIconProps = {
	/** Block type name */
	type: string;
	/** Custom class name */
	className?: string;
	/** Icon size */
	size?: number;
};

// ============================================================================
// Component
// ============================================================================

const DEFAULT_BLOCK_ICON_REFERENCE: ComponentReference = {
	type: "icon",
	props: { name: "ph:cube" },
};

export const BlockTypeIcon = React.memo(function BlockTypeIcon({
	type,
	className,
	size = 16,
}: BlockTypeIconProps) {
	const blockDef = useBlockDefinition(type);
	const iconRef = blockDef?.admin?.icon;

	// Use BlockIcon which provides default cube icon
	return <BlockIcon icon={iconRef} className={className} size={size} />;
});

/**
 * Standalone icon component that doesn't require context.
 * Useful for rendering icons outside the editor.
 * Shows a default cube icon if no icon is provided.
 */
export const BlockIcon = React.memo(function BlockIcon({
	icon,
	className,
	size = 16,
}: {
	icon?: ComponentReference | string;
	className?: string;
	size?: number;
}) {
	const reference = React.useMemo(() => normalizeIconReference(icon), [icon]);

	// Use default cube icon if no icon provided
	const finalReference = reference ?? DEFAULT_BLOCK_ICON_REFERENCE;
	const mergedClassName = React.useMemo(
		() => cn("shrink-0", className),
		[className],
	);
	const additionalProps = React.useMemo(
		() => ({ className: mergedClassName, size }),
		[mergedClassName, size],
	);

	return (
		<ComponentRenderer
			reference={finalReference}
			additionalProps={additionalProps}
		/>
	);
});

// ============================================================================
// Helpers
// ============================================================================

function normalizeIconReference(
	icon?: ComponentReference | string,
): ComponentReference | undefined {
	if (!icon) return undefined;
	if (typeof icon === "string") {
		return { type: "icon", props: { name: icon } };
	}
	return icon;
}
