/**
 * Block Type Icon
 *
 * Displays the icon for a block type using component references.
 */

"use client";

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

export function BlockTypeIcon({
	type,
	className,
	size = 16,
}: BlockTypeIconProps) {
	const blockDef = useBlockDefinition(type);
	const iconRef = blockDef?.admin?.icon;
	const reference = normalizeIconReference(iconRef);

	if (!reference) {
		return null;
	}

	return (
		<ComponentRenderer
			reference={reference}
			additionalProps={{ className: cn("shrink-0", className), size }}
		/>
	);
}

/**
 * Standalone icon component that doesn't require context.
 * Useful for rendering icons outside the editor.
 */
export function BlockIcon({
	icon,
	className,
	size = 16,
}: {
	icon?: ComponentReference | string;
	className?: string;
	size?: number;
}) {
	const reference = normalizeIconReference(icon);
	if (!reference) {
		return null;
	}
	return (
		<ComponentRenderer
			reference={reference}
			additionalProps={{ className: cn("shrink-0", className), size }}
		/>
	);
}

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
