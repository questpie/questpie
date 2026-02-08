/**
 * Admin Config Functions
 *
 * Provides server-defined admin configuration (dashboard, sidebar,
 * collection/global metadata) to the client via functions API.
 *
 * Filters results by the current user's read access.
 *
 * @example
 * ```ts
 * // Client usage
 * const config = await cms.api.functions.getAdminConfig();
 * // { dashboard: {...}, sidebar: {...}, collections: {...}, globals: {...} }
 * ```
 */

import { executeAccessRule, fn, type Questpie } from "questpie";
import { z } from "zod";
import type {
	AdminCollectionConfig,
	AdminGlobalConfig,
	IconReference,
	ServerDashboardConfig,
	ServerDashboardItem,
	ServerSidebarConfig,
	ServerSidebarSection,
} from "../../../augmentation.js";
import { introspectBlocks } from "../../../block/introspection.js";

// ============================================================================
// Type Helpers
// ============================================================================

type AdminConfigItemMeta = {
	label?: unknown;
	description?: unknown;
	icon?: IconReference;
	hidden?: boolean;
	group?: string;
	order?: number;
};

/**
 * Helper to get typed CMS app from handler context.
 */
function getApp(ctx: { app: unknown }): Questpie<any> {
	return ctx.app as Questpie<any>;
}

// ============================================================================
// Access Control Helpers
// ============================================================================

/**
 * Check if the current user has read access to a collection or global.
 * Returns true if accessible, false if denied.
 * Fail-open: returns true on errors to avoid hiding content due to rule bugs.
 */
async function hasReadAccess(
	readRule: unknown,
	ctx: { app: unknown; session?: any; db: any; locale?: string },
): Promise<boolean> {
	if (readRule === undefined || readRule === true) return true;
	if (readRule === false) return false;
	try {
		const result = await executeAccessRule(readRule as any, {
			cms: ctx.app as any,
			db: ctx.db,
			session: ctx.session,
			locale: ctx.locale,
		});
		return result !== false; // AccessWhere = still visible (row-level filter, but collection itself is accessible)
	} catch {
		return true; // Fail-open: don't hide content due to access rule errors
	}
}

// ============================================================================
// Metadata Extraction
// ============================================================================

/**
 * Extract admin metadata from all registered collections.
 */
function extractCollectionsMeta(
	cms: Questpie<any>,
): Record<string, AdminConfigItemMeta> {
	const result: Record<string, AdminConfigItemMeta> = {};
	const collections = cms.getCollections();

	for (const [name, collection] of Object.entries(collections)) {
		const admin: AdminCollectionConfig | undefined = (collection as any).state
			?.admin;
		if (admin) {
			result[name] = {
				label: admin.label,
				description: admin.description,
				icon: admin.icon,
				hidden: admin.hidden,
				group: admin.group,
				order: admin.order,
			};
		} else {
			result[name] = {};
		}
	}

	return result;
}

/**
 * Extract admin metadata from all registered globals.
 */
function extractGlobalsMeta(
	cms: Questpie<any>,
): Record<string, AdminConfigItemMeta> {
	const result: Record<string, AdminConfigItemMeta> = {};
	const globals = cms.getGlobals();

	for (const [name, global] of Object.entries(globals)) {
		const admin: AdminGlobalConfig | undefined = (global as any).state?.admin;
		if (admin) {
			result[name] = {
				label: admin.label,
				description: admin.description,
				icon: admin.icon,
				hidden: admin.hidden,
				group: admin.group,
				order: admin.order,
			};
		} else {
			result[name] = {};
		}
	}

	return result;
}

// ============================================================================
// Auto-Sidebar Generation
// ============================================================================

/**
 * Auto-generate a sidebar config from pre-filtered collection and global metadata.
 * Used when no explicit `.sidebar()` is configured.
 */
function buildAutoSidebar(
	collectionsMeta: Record<string, AdminConfigItemMeta>,
	globalsMeta: Record<string, AdminConfigItemMeta>,
): ServerSidebarConfig {
	// Group collections by their admin.group property
	const ungrouped: Array<{ name: string; meta: AdminConfigItemMeta }> = [];
	const grouped: Record<
		string,
		Array<{ name: string; meta: AdminConfigItemMeta }>
	> = {};

	for (const [name, meta] of Object.entries(collectionsMeta)) {
		if (meta.hidden) continue;
		if (meta.group) {
			if (!grouped[meta.group]) grouped[meta.group] = [];
			grouped[meta.group].push({ name, meta });
		} else {
			ungrouped.push({ name, meta });
		}
	}

	// Sort by order within each group
	const sortByOrder = (
		a: { meta: AdminConfigItemMeta },
		b: { meta: AdminConfigItemMeta },
	) => (a.meta.order ?? 0) - (b.meta.order ?? 0);

	ungrouped.sort(sortByOrder);
	for (const items of Object.values(grouped)) {
		items.sort(sortByOrder);
	}

	const sections: ServerSidebarSection[] = [];

	// Content section: ungrouped collections
	if (ungrouped.length > 0) {
		sections.push({
			id: "content",
			title: { en: "Content" },
			items: ungrouped.map(({ name, meta }) => ({
				type: "collection" as const,
				collection: name,
				label: meta.label as any,
				icon: meta.icon,
			})),
		});
	}

	// Named sections for grouped collections
	const sortedGroupNames = Object.keys(grouped).sort();
	for (const groupName of sortedGroupNames) {
		const items = grouped[groupName];
		sections.push({
			id: `group:${groupName}`,
			title: { en: groupName.charAt(0).toUpperCase() + groupName.slice(1) },
			items: items.map(({ name, meta }) => ({
				type: "collection" as const,
				collection: name,
				label: meta.label as any,
				icon: meta.icon,
			})),
		});
	}

	// Globals section
	const visibleGlobals = Object.entries(globalsMeta).filter(
		([, meta]) => !meta.hidden,
	);
	if (visibleGlobals.length > 0) {
		visibleGlobals.sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0));
		sections.push({
			id: "globals",
			title: { en: "Globals" },
			items: visibleGlobals.map(([name, meta]) => ({
				type: "global" as const,
				global: name,
				label: meta.label as any,
				icon: meta.icon,
			})),
		});
	}

	return { sections };
}

// ============================================================================
// Sidebar Filtering (explicit sidebar config)
// ============================================================================

/**
 * Filter an explicit sidebar config by accessible collections and globals.
 * Removes items referencing inaccessible collections/globals.
 * Removes empty sections after filtering.
 */
function filterSidebarConfig(
	config: ServerSidebarConfig,
	accessibleCollections: Set<string>,
	accessibleGlobals: Set<string>,
): ServerSidebarConfig {
	return {
		sections: config.sections
			.map((s) => ({
				...s,
				items: s.items.filter((item) => {
					if (item.type === "collection")
						return accessibleCollections.has((item as any).collection);
					if (item.type === "global")
						return accessibleGlobals.has((item as any).global);
					return true; // pages, links, dividers always pass
				}),
			}))
			.filter((s) => s.items.length > 0),
	};
}

/**
 * Collect all collection and global names referenced in a sidebar config.
 */
function collectSidebarReferences(config: ServerSidebarConfig): {
	collections: Set<string>;
	globals: Set<string>;
} {
	const collections = new Set<string>();
	const globals = new Set<string>();
	for (const section of config.sections) {
		for (const item of section.items) {
			if (item.type === "collection") collections.add((item as any).collection);
			else if (item.type === "global") globals.add((item as any).global);
		}
	}
	return { collections, globals };
}

// ============================================================================
// Dashboard Processing (access + serialization + ID assignment)
// ============================================================================

/**
 * Auto-assign IDs to widgets that don't have one.
 * Needed for fetchWidgetData lookup by widget ID.
 */
function assignWidgetIds(items: ServerDashboardItem[]): void {
	let counter = 0;
	function walk(items: ServerDashboardItem[]) {
		for (const item of items) {
			if (item.type === "section") {
				walk((item as any).items || []);
			} else if (item.type === "tabs") {
				for (const tab of (item as any).tabs || []) {
					walk(tab.items || []);
				}
			} else {
				// Widget — assign ID if missing
				if (!(item as any).id) {
					(item as any).id = `__auto_${item.type}_${counter++}`;
				}
			}
		}
	}
	walk(items);
}

/**
 * Process dashboard items: evaluate access, strip non-serializable props,
 * mark hasFetchFn, and filter by collection access.
 */
async function processDashboardItems(
	items: ServerDashboardItem[],
	accessibleCollections: Set<string>,
	accessCtx: { app: unknown; session?: any; db: any; locale?: string },
): Promise<ServerDashboardItem[]> {
	const result: ServerDashboardItem[] = [];

	for (const item of items) {
		// Recurse into sections
		if (item.type === "section") {
			const filtered = await processDashboardItems(
				(item as any).items || [],
				accessibleCollections,
				accessCtx,
			);
			if (filtered.length > 0) {
				result.push({ ...item, items: filtered } as any);
			}
			continue;
		}

		// Recurse into tabs
		if (item.type === "tabs") {
			const tabs = [];
			for (const tab of (item as any).tabs || []) {
				const filtered = await processDashboardItems(
					tab.items || [],
					accessibleCollections,
					accessCtx,
				);
				tabs.push({ ...tab, items: filtered });
			}
			result.push({ ...item, tabs } as any);
			continue;
		}

		// Widget processing
		const widget = item as any;

		// 1. Check per-widget access
		if (widget.access !== undefined) {
			const widgetAccessResult =
				typeof widget.access === "function"
					? await widget.access({
							cms: accessCtx.app,
							db: accessCtx.db,
							session: accessCtx.session,
							locale: accessCtx.locale,
						})
					: widget.access;
			if (widgetAccessResult === false) continue;
		}

		// 2. Check collection access for collection-bound widgets
		if (widget.collection && !accessibleCollections.has(widget.collection)) {
			continue;
		}

		// 3. Filter quickActions' individual actions by collection access
		if (widget.type === "quickActions") {
			const actions = (widget.actions || []).filter((action: any) => {
				if (action.action?.type === "create") {
					return accessibleCollections.has(action.action.collection);
				}
				return true;
			});
			const { fetchFn, access, ...serializable } = widget;
			result.push({ ...serializable, actions } as any);
			continue;
		}

		// 4. Strip non-serializable props, mark hasFetchFn
		const { fetchFn, access, filterFn, ...serializable } = widget;
		if (fetchFn) {
			serializable.hasFetchFn = true;
		}
		result.push(serializable);
	}

	return result;
}

// ============================================================================
// Schema Definitions
// ============================================================================

const getAdminConfigSchema = z.object({}).optional();

// Output schema is flexible since dashboard/sidebar configs are complex
const getAdminConfigOutputSchema = z.object({
	dashboard: z.unknown().optional(),
	sidebar: z.unknown().optional(),
	branding: z.unknown().optional(),
	blocks: z.record(z.string(), z.unknown()).optional(),
	collections: z.record(z.string(), z.unknown()).optional(),
	globals: z.record(z.string(), z.unknown()).optional(),
});

// ============================================================================
// Functions
// ============================================================================

/**
 * Get admin configuration including dashboard, sidebar, blocks,
 * and collection/global metadata.
 *
 * Filters all results by the current user's read access rules.
 *
 * @example
 * ```ts
 * // In your CMS
 * const cms = q({ name: "my-app" })
 *   .use(adminModule)
 *   .dashboard(({ d }) => d.dashboard({
 *     title: { en: "Dashboard" },
 *     items: [...],
 *   }))
 *   .sidebar(({ s }) => s.sidebar({
 *     sections: [...],
 *   }))
 *   .build({ ... });
 *
 * // Client fetches config
 * const config = await cms.api.functions.getAdminConfig();
 * ```
 */
export const getAdminConfig = fn({
	type: "query",
	schema: getAdminConfigSchema,
	outputSchema: getAdminConfigOutputSchema,
	handler: async (ctx) => {
		const cms = getApp(ctx);
		const state = (cms as any).state || {};

		// 1. Compute accessible collections and globals
		const collections = cms.getCollections();
		const globals = cms.getGlobals();
		const accessCtx = {
			app: cms,
			session: (ctx as any).session,
			db: (ctx as any).db,
			locale: (ctx as any).locale,
		};

		const accessibleCollections = new Set<string>();
		for (const [name, col] of Object.entries(collections)) {
			if (await hasReadAccess((col as any).state?.access?.read, accessCtx)) {
				accessibleCollections.add(name);
			}
		}

		const accessibleGlobals = new Set<string>();
		for (const [name, g] of Object.entries(globals)) {
			if (await hasReadAccess((g as any).state?.access?.read, accessCtx)) {
				accessibleGlobals.add(name);
			}
		}

		// 2. Extract and filter metadata
		const allCollectionsMeta = extractCollectionsMeta(cms);
		const allGlobalsMeta = extractGlobalsMeta(cms);

		const filteredCollectionsMeta = Object.fromEntries(
			Object.entries(allCollectionsMeta).filter(([n]) =>
				accessibleCollections.has(n),
			),
		);
		const filteredGlobalsMeta = Object.fromEntries(
			Object.entries(allGlobalsMeta).filter(([n]) => accessibleGlobals.has(n)),
		);

		const response: {
			dashboard?: unknown;
			sidebar?: unknown;
			branding?: { name?: unknown; logo?: unknown };
			blocks?: Record<string, unknown>;
			collections?: Record<string, unknown>;
			globals?: Record<string, unknown>;
		} = {};

		// Branding config
		if (state.branding) {
			response.branding = state.branding;
		}

		// 3. Dashboard: assign IDs, process access, strip non-serializable
		if (state.dashboard) {
			const dashboard = state.dashboard as ServerDashboardConfig;
			if (dashboard.items) {
				assignWidgetIds(dashboard.items);
			}
			response.dashboard = {
				...dashboard,
				items: dashboard.items
					? await processDashboardItems(
							dashboard.items,
							accessibleCollections,
							accessCtx,
						)
					: undefined,
			};
		}

		// 4. Sidebar: explicit → filter + auto-append unlisted; auto → build from filtered meta
		if (state.sidebar) {
			const filteredSidebar = filterSidebarConfig(
				state.sidebar,
				accessibleCollections,
				accessibleGlobals,
			);

			// Find collections/globals the user explicitly listed
			const referenced = collectSidebarReferences(state.sidebar);

			// Find non-hidden accessible items NOT referenced in the explicit sidebar
			const unlistedCollectionsMeta = Object.fromEntries(
				Object.entries(filteredCollectionsMeta).filter(
					([name, meta]) => !referenced.collections.has(name) && !meta.hidden,
				),
			);
			const unlistedGlobalsMeta = Object.fromEntries(
				Object.entries(filteredGlobalsMeta).filter(
					([name, meta]) => !referenced.globals.has(name) && !meta.hidden,
				),
			);

			// Auto-generate sections for unlisted items, append after explicit sections
			const unlistedSidebar = buildAutoSidebar(
				unlistedCollectionsMeta,
				unlistedGlobalsMeta,
			);

			response.sidebar = {
				sections: [...filteredSidebar.sections, ...unlistedSidebar.sections],
			};
		} else {
			response.sidebar = buildAutoSidebar(
				filteredCollectionsMeta,
				filteredGlobalsMeta,
			);
		}

		// 5. Blocks: unchanged (not access-controlled)
		if (state.blocks && Object.keys(state.blocks).length > 0) {
			response.blocks = introspectBlocks(state.blocks);
		}

		// 6. Return filtered metadata
		response.collections = filteredCollectionsMeta;
		response.globals = filteredGlobalsMeta;

		return response;
	},
});

// ============================================================================
// Export Bundle
// ============================================================================

/**
 * Admin config functions group.
 * Add to your CMS via `.functions(adminConfigFunctions)`.
 */
export const adminConfigFunctions = {
	getAdminConfig,
} as const;
