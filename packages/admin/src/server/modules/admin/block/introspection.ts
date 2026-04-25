/**
 * Block Introspection
 *
 * Provides introspection of registered blocks for admin UI consumption.
 */

import type { FieldSchema } from "questpie";
import { type I18nText, isI18nLocaleMap } from "questpie/shared";

import type {
	AdminBlockConfig,
	BlockCategoryConfig,
	ComponentReference,
	FieldLayoutItem,
} from "../../../augmentation.js";
import type { AnyBlockDefinition, BlockBuilderState } from "./block-builder.js";

// ============================================================================
// Block Schema Types
// ============================================================================

/**
 * Introspected block schema for admin consumption.
 * All admin metadata comes from the .admin() configuration.
 */
export interface BlockSchema {
	/** Block type name */
	name: string;

	/** Admin configuration */
	admin?: {
		/** Display label */
		label?: I18nText;
		/** Description */
		description?: I18nText;
		/** Icon reference */
		icon?: ComponentReference;
		/** Category for grouping in block picker */
		category?: BlockCategoryConfig;
		/** Order within category in block picker */
		order?: number;
		/** Hide from block picker */
		hidden?: boolean;
	};

	/** Allow child blocks */
	allowChildren?: boolean;

	/** Maximum number of child blocks */
	maxChildren?: number;

	/** Has prefetch function */
	hasPrefetch: boolean;

	/** Field schemas - unified format using FieldSchema */
	fields: Record<string, FieldSchema>;

	/** Form layout for block fields (sections, tabs, grid) */
	form?: { fields: FieldLayoutItem[] };

	/** Validation schemas */
	validation?: {
		insert?: unknown;
		update?: unknown;
	};
}

/**
 * Category info extracted from blocks for UI rendering.
 */
interface CategoryInfo {
	/** Category key (derived from label or auto-generated) */
	key: string;
	/** Category configuration */
	config: BlockCategoryConfig;
	/** Blocks in this category */
	blocks: BlockSchema[];
}

// ============================================================================
// Introspection Functions
// ============================================================================

/**
 * Normalize a block entry to a BlockDefinition.
 * App state may contain either built BlockDefinition objects (with getFieldMetadata)
 * or raw BlockBuilder instances (with a .build() method). This normalizes both
 * to a BlockDefinition by calling .build() on builders.
 */
function normalizeBlockDef(blockDef: any): AnyBlockDefinition {
	if (typeof blockDef?.build === "function" && !blockDef.getFieldMetadata) {
		return blockDef.build();
	}
	return blockDef;
}

/**
 * Introspect a single block definition.
 * Handles both server BlockBuilder definitions and client BlockDefinition objects
 * that were converted via the `.blocks()` patch.
 */
export function introspectBlock(blockDef: AnyBlockDefinition): BlockSchema {
	const resolved = normalizeBlockDef(blockDef);
	const state = resolved.state;

	return {
		name: state.name ?? resolved.name,
		admin: state.admin,
		allowChildren: state.allowChildren,
		maxChildren: state.maxChildren,
		hasPrefetch: typeof state.prefetch === "function",
		fields: resolved.getFieldMetadata(),
		form: state.form,
	};
}

/**
 * Introspect all registered blocks.
 *
 * @param blocks - Record of registered block definitions
 * @returns Record of block schemas
 *
 * @example
 * ```ts
 * import { introspectBlocks } from "@questpie/admin/server";
 *
 * // In an API route
 * const blocks = introspectBlocks(app.state.blocks);
 * return Response.json({ blocks });
 * ```
 */
export function introspectBlocks(
	blocks: Record<string, AnyBlockDefinition> | undefined,
): Record<string, BlockSchema> {
	if (!blocks) {
		return {};
	}

	const schemas: Record<string, BlockSchema> = {};

	for (const [name, blockDef] of Object.entries(blocks)) {
		const schema = introspectBlock(blockDef);
		schemas[schema.name || name] = schema;
	}

	return schemas;
}

/**
 * Generate a category key from category config.
 * Uses English label as key, falling back to first available label.
 */
function getCategoryKey(category: BlockCategoryConfig): string {
	const { label } = category;

	if (typeof label === "string") {
		return label.toLowerCase().replace(/\s+/g, "-");
	}

	// For locale map or translation key
	if (isI18nLocaleMap(label)) {
		// Use English label as key, or first available
		const text = label.en ?? Object.values(label)[0] ?? "";
		return text.toLowerCase().replace(/\s+/g, "-");
	}

	// Translation key - use the key itself
	return label.key.toLowerCase().replace(/[.:]/g, "-");
}

/**
 * Get blocks grouped by category with full category info.
 * Useful for block picker UI.
 */
export function getBlocksByCategory(
	blocks: Record<string, BlockSchema>,
): CategoryInfo[] {
	const categoryMap = new Map<string, CategoryInfo>();

	// Default uncategorized category
	const uncategorizedKey = "uncategorized";
	const uncategorizedConfig: BlockCategoryConfig = {
		label: { en: "Uncategorized" },
		order: 999,
	};

	for (const block of Object.values(blocks)) {
		// Skip hidden blocks
		if (block.admin?.hidden) continue;

		const categoryConfig = block.admin?.category;
		let key: string;
		let config: BlockCategoryConfig;

		if (categoryConfig) {
			key = getCategoryKey(categoryConfig);
			config = categoryConfig;
		} else {
			key = uncategorizedKey;
			config = uncategorizedConfig;
		}

		if (!categoryMap.has(key)) {
			categoryMap.set(key, {
				key,
				config,
				blocks: [],
			});
		}

		categoryMap.get(key)!.blocks.push(block);
	}

	// Convert to array and sort
	const categories = Array.from(categoryMap.values());

	// Sort categories by order
	categories.sort((a, b) => (a.config.order ?? 999) - (b.config.order ?? 999));

	// Sort blocks within each category by order
	for (const category of categories) {
		category.blocks.sort(
			(a, b) => (a.admin?.order ?? 999) - (b.admin?.order ?? 999),
		);
	}

	return categories;
}
