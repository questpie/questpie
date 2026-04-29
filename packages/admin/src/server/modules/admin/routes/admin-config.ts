/**
 * Admin Config Functions
 *
 * Provides server-defined admin configuration (dashboard, sidebar,
 * collection/global metadata) to the client via RPC.
 *
 * Filters results by the current user's read access.
 *
 * @example
 * ```ts
 * // Client usage
 * const config = await client.routes.getAdminConfig({});
 * // { dashboard: {...}, sidebar: {...}, collections: {...}, globals: {...} }
 * ```
 */

import { executeAccessRule, type Questpie, route } from "questpie";
import { z } from "zod";

import type {
	AdminCollectionConfig,
	AdminGlobalConfig,
	ComponentReference,
	DashboardContribution,
	DashboardItemDef,
	ServerDashboardConfig,
	ServerDashboardItem,
	ServerSidebarConfig,
	ServerSidebarSection,
	SidebarContribution,
	SidebarItemDef,
} from "../../../augmentation.js";
import {
	resolveDashboardCallback,
	resolveSidebarCallback,
} from "../../../proxy-factories.js";
import { introspectBlocks } from "../block/introspection.js";
import { adminConfigDTOSchema } from "../dto/admin-config.dto.js";
import {
	type App,
	getAccessContext,
	getAdminConfig as getAdminCfg,
	getApp,
	getAppState,
	getCollectionState,
	getGlobalState,
} from "./route-helpers.js";

// ============================================================================
// Type Helpers
// ============================================================================

type WorkflowMeta = {
	enabled: boolean;
	initialStage: string;
	stages: Array<{
		name: string;
		label?: string;
		description?: string;
		transitions?: string[];
	}>;
};

type AdminConfigItemMeta = {
	label?: unknown;
	description?: unknown;
	icon?: ComponentReference;
	hidden?: boolean;
	group?: string;
	order?: number;
	workflow?: WorkflowMeta;
};

// ============================================================================
// Access Control Helpers
// ============================================================================

/**
 * Check if the current user has read access to a collection or global.
 * Returns true if accessible, false if denied.
 *
 * Falls back to app `defaultAccess.read` when no explicit read rule is defined.
 * If neither exists, requires session (secure by default).
 *
 * Fail-open on errors: returns true to avoid hiding content due to rule bugs.
 */
async function hasReadAccess(
	readRule: unknown,
	ctx: { app: App; session?: any; db: any; locale?: string },
): Promise<boolean> {
	// Fall back to app defaultAccess.read if no explicit rule
	const effectiveRule = readRule ?? ctx.app?.defaultAccess?.read;

	if (effectiveRule === true) return true;
	if (effectiveRule === false) return false;

	// No rule anywhere = require session (secure by default)
	if (effectiveRule === undefined) return !!ctx.session;

	try {
		const result = await executeAccessRule(effectiveRule as any, {
			app: ctx.app as any,
			db: ctx.db,
			session: ctx.session,
			locale: ctx.locale,
		});
		return result !== false; // AccessWhere = still visible (row-level filter, but collection itself is accessible)
	} catch {
		return false; // Fail-closed: deny access on rule errors
	}
}

// ============================================================================
// Metadata Extraction
// ============================================================================

/**
 * Extract workflow metadata from a collection/global state.
 */
function extractWorkflowMeta(
	state: Record<string, any>,
): WorkflowMeta | undefined {
	// Workflow is nested under versioning
	const versioning = state?.options?.versioning;
	const workflow =
		versioning && typeof versioning === "object"
			? versioning.workflow
			: undefined;
	if (!workflow) return undefined;

	const opts = workflow === true ? {} : workflow;
	const rawStages = opts.stages;

	let stages: WorkflowMeta["stages"];
	if (!rawStages) {
		stages = [{ name: "draft" }, { name: "published" }];
	} else if (Array.isArray(rawStages)) {
		stages = rawStages.map((name: string) => ({ name }));
	} else {
		stages = Object.entries(rawStages).map(
			([name, options]: [string, any]) => ({
				name,
				label: options?.label,
				description: options?.description,
				transitions: options?.transitions,
			}),
		);
	}

	return {
		enabled: true,
		initialStage: opts.initialStage ?? stages[0]?.name ?? "draft",
		stages,
	};
}

/**
 * Extract admin metadata from all registered collections.
 */
function extractCollectionsMeta(app: App): Record<string, AdminConfigItemMeta> {
	const result: Record<string, AdminConfigItemMeta> = {};
	const collections = app.getCollections();

	for (const [name, collection] of Object.entries(collections)) {
		const state = getCollectionState(collection);
		const admin: AdminCollectionConfig | undefined = state?.admin;
		const workflow = extractWorkflowMeta(state);
		if (admin) {
			result[name] = {
				label: admin.label,
				description: admin.description,
				icon: admin.icon,
				hidden: admin.hidden,
				group: admin.group,
				order: admin.order,
				...(workflow ? { workflow } : {}),
			};
		} else {
			result[name] = workflow ? { workflow } : {};
		}
	}

	return result;
}

/**
 * Extract admin metadata from all registered globals.
 */
function extractGlobalsMeta(app: App): Record<string, AdminConfigItemMeta> {
	const result: Record<string, AdminConfigItemMeta> = {};
	const globals = app.getGlobals();

	for (const [name, global] of Object.entries(globals)) {
		const state = getGlobalState(global);
		const admin: AdminGlobalConfig | undefined = state?.admin;
		const workflow = extractWorkflowMeta(state);
		if (admin) {
			result[name] = {
				label: admin.label,
				description: admin.description,
				icon: admin.icon,
				hidden: admin.hidden,
				group: admin.group,
				order: admin.order,
				...(workflow ? { workflow } : {}),
			};
		} else {
			result[name] = workflow ? { workflow } : {};
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
				items: (s.items ?? []).filter((item) => {
					const rec = item as unknown as Record<string, unknown>;
					if (item.type === "collection")
						return accessibleCollections.has(rec.collection as string);
					if (item.type === "global")
						return accessibleGlobals.has(rec.global as string);
					return true; // pages, links, dividers always pass
				}),
			}))
			.filter(
				(s) => (s.items?.length ?? 0) > 0 || (s.sections?.length ?? 0) > 0,
			),
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

	function collectFromSection(section: ServerSidebarSection): void {
		for (const item of section.items ?? []) {
			const rec = item as unknown as Record<string, unknown>;
			if (item.type === "collection") collections.add(rec.collection as string);
			else if (item.type === "global") globals.add(rec.global as string);
		}
		for (const subSection of section.sections ?? []) {
			collectFromSection(subSection);
		}
	}

	for (const section of config.sections) {
		collectFromSection(section);
	}
	return { collections, globals };
}

// ============================================================================
// Contribution Merging (SidebarContribution[] → ServerSidebarConfig, etc.)
// ============================================================================

/**
 * Normalize sidebar/dashboard state from instance.state.
 * The state can be:
 * - An array of SidebarContribution[] (new composable pattern)
 * - A single SidebarContribution or SidebarCallback (legacy or config-level)
 * - A ServerSidebarConfig (old builder pattern from .sidebar() method)
 *
 * Returns a normalized array of contributions.
 */
function normalizeSidebarContributions(raw: unknown): SidebarContribution[] {
	if (!raw) return [];
	if (Array.isArray(raw)) {
		// Array of contributions — may contain callbacks, objects, or mixed
		const result: SidebarContribution[] = [];
		for (const item of raw) {
			const resolved = resolveSidebarCallback(item);
			if (resolved) result.push(resolved);
		}
		return result;
	}
	// Single callback or contribution
	const resolved = resolveSidebarCallback(raw);
	return resolved ? [resolved] : [];
}

function normalizeDashboardContributions(
	raw: unknown,
): DashboardContribution[] {
	if (!raw) return [];
	if (Array.isArray(raw)) {
		const result: DashboardContribution[] = [];
		for (const item of raw) {
			const resolved = resolveDashboardCallback(item);
			if (resolved) result.push(resolved);
		}
		return result;
	}
	const resolved = resolveDashboardCallback(raw);
	return resolved ? [resolved] : [];
}

/**
 * Merge SidebarContribution[] into a ServerSidebarConfig.
 *
 * Rules (§5.8.3):
 * - Sections: deduplicated by id. Later contribution wins for title/icon/collapsible.
 * - Items: grouped by sectionId. Appended in module resolution order.
 *   Items with `position: "start"` are prepended to the section.
 * - Sections appear in the order they were first defined.
 */
function mergeSidebarContributions(
	contributions: SidebarContribution[],
): ServerSidebarConfig {
	// Collect section definitions — later wins for metadata
	const sectionOrder: string[] = [];
	const sectionDefs = new Map<
		string,
		{ title?: unknown; icon?: unknown; collapsible?: boolean }
	>();
	// Collect items by sectionId
	const sectionItems = new Map<string, SidebarItemDef[]>();

	for (const contrib of contributions) {
		// Process sections
		if (contrib.sections) {
			for (const sec of contrib.sections) {
				// Later definitions (user config) override section order
				const existingIdx = sectionOrder.indexOf(sec.id);
				if (existingIdx !== -1) {
					sectionOrder.splice(existingIdx, 1);
				}
				sectionOrder.push(sec.id);
				// Later wins for metadata
				sectionDefs.set(sec.id, {
					title: sec.title ?? sectionDefs.get(sec.id)?.title,
					icon: sec.icon ?? sectionDefs.get(sec.id)?.icon,
					collapsible: sec.collapsible ?? sectionDefs.get(sec.id)?.collapsible,
				});
			}
		}

		// Process items
		if (contrib.items) {
			for (const item of contrib.items) {
				const sid = item.sectionId;
				if (!sectionItems.has(sid)) {
					sectionItems.set(sid, []);
				}
				const items = sectionItems.get(sid) ?? [];
				if (item.position === "start") {
					items.unshift(item);
				} else {
					items.push(item);
				}
				sectionItems.set(sid, items);
				// Ensure section exists even if not explicitly defined
				if (!sectionDefs.has(sid)) {
					sectionOrder.push(sid);
					sectionDefs.set(sid, {});
				}
			}
		}
	}

	// Build final ServerSidebarConfig
	const sections: ServerSidebarSection[] = [];
	for (const sectionId of sectionOrder) {
		const def = sectionDefs.get(sectionId);
		const items = sectionItems.get(sectionId) ?? [];

		sections.push({
			id: sectionId,
			title: def?.title as any,
			icon: def?.icon as any,
			collapsible: def?.collapsible,
			items: items.map(
				({ sectionId: _sid, position: _pos, ...rest }) => rest as any,
			),
		});
	}

	return { sections };
}

/**
 * Merge DashboardContribution[] into a ServerDashboardConfig.
 *
 * Rules (§5.8.3):
 * - Metadata (title, description, columns, realtime): last non-undefined wins.
 * - Actions: concatenated from all contributions.
 * - Sections: deduplicated by id. Later wins for label/layout/columns.
 * - Items: grouped by sectionId. Appended in module resolution order.
 *   Items with `position: "start"` are prepended.
 */
function mergeDashboardContributions(
	contributions: DashboardContribution[],
): ServerDashboardConfig {
	let title: unknown;
	let description: unknown;
	let columns: number | undefined;
	let rowHeight: number | string | undefined;
	let gap: number | undefined;
	let realtime: boolean | undefined;
	const allActions: unknown[] = [];

	const sectionOrder: string[] = [];
	const sectionDefs = new Map<string, Record<string, unknown>>();
	const sectionItems = new Map<string, DashboardItemDef[]>();
	const directItems: ServerDashboardItem[] = [];

	for (const contrib of contributions) {
		if (contrib.title !== undefined) title = contrib.title;
		if (contrib.description !== undefined) description = contrib.description;
		if (contrib.columns !== undefined) columns = contrib.columns;
		if ((contrib as Record<string, unknown>).rowHeight !== undefined) {
			rowHeight = (contrib as Record<string, unknown>).rowHeight as
				| number
				| string;
		}
		if ((contrib as Record<string, unknown>).gap !== undefined) {
			gap = (contrib as Record<string, unknown>).gap as number;
		}
		if (contrib.realtime !== undefined) realtime = contrib.realtime;

		if (contrib.actions) {
			allActions.push(...contrib.actions);
		}

		if (contrib.sections) {
			for (const sec of contrib.sections) {
				const { id: _id, ...sectionMeta } = sec as unknown as Record<
					string,
					unknown
				>;
				// Later definitions (user config) override section order
				const existingIdx = sectionOrder.indexOf(sec.id);
				if (existingIdx !== -1) {
					sectionOrder.splice(existingIdx, 1);
				}
				sectionOrder.push(sec.id);
				sectionDefs.set(sec.id, {
					...(sectionDefs.get(sec.id) ?? {}),
					...sectionMeta,
				});
			}
		}

		if (contrib.items) {
			for (const item of contrib.items) {
				const record = item as unknown as Record<string, unknown>;
				const sid = record.sectionId as string | undefined;
				if (!sid) {
					directItems.push(item as unknown as ServerDashboardItem);
					continue;
				}
				if (!sectionItems.has(sid)) {
					sectionItems.set(sid, []);
				}
				const items = sectionItems.get(sid) ?? [];
				if (record.position === "start") {
					items.unshift(item as DashboardItemDef);
				} else {
					items.push(item as DashboardItemDef);
				}
				sectionItems.set(sid, items);
				if (!sectionDefs.has(sid)) {
					sectionOrder.push(sid);
					sectionDefs.set(sid, {});
				}
			}
		}
	}

	// Build final ServerDashboardConfig
	const dashboardItems: ServerDashboardItem[] = [...directItems];
	for (const sectionId of sectionOrder) {
		const def = sectionDefs.get(sectionId);
		const items = sectionItems.get(sectionId) ?? [];

		if (items.length > 0 || def?.label) {
			dashboardItems.push({
				type: "section",
				id: sectionId,
				...def,
				layout: def?.layout ?? "grid",
				items: items.map(
					({ sectionId: _sid, position: _pos, ...rest }) => rest as any,
				),
			} as any);
		}
	}

	return {
		title: title as any,
		description: description as any,
		columns,
		rowHeight,
		gap,
		realtime,
		actions: allActions.length > 0 ? (allActions as any) : undefined,
		items: dashboardItems.length > 0 ? dashboardItems : undefined,
	};
}

/**
 * Check whether a state value looks like legacy ServerSidebarConfig
 * (has .sections array directly) vs contribution-based (array of contributions).
 */
function isLegacySidebarConfig(value: unknown): value is ServerSidebarConfig {
	if (value == null || typeof value !== "object" || Array.isArray(value))
		return false;
	const obj = value as Record<string, unknown>;
	// Legacy format has sections with nested items already grouped.
	// Contribution format has separate sections + items arrays (items have sectionId).
	if (Array.isArray(obj.sections) && Array.isArray(obj.items)) return false;
	return Array.isArray(obj.sections);
}

/**
 * Check whether a state value looks like legacy ServerDashboardConfig
 * (has .items or .title directly) vs contribution-based.
 */
function isLegacyDashboardConfig(
	value: unknown,
): value is ServerDashboardConfig {
	if (value == null || typeof value !== "object" || Array.isArray(value))
		return false;
	const obj = value as Record<string, unknown>;
	// Contribution format has sections + items arrays (items have sectionId).
	// Legacy format has items as processed ServerDashboardItem[] (section type items with nested items).
	if (Array.isArray(obj.sections) && Array.isArray(obj.items)) return false;
	return "items" in obj || "title" in obj;
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
			const rec = item as unknown as Record<string, unknown>;
			if (item.type === "section") {
				walk((rec.items as unknown as ServerDashboardItem[]) || []);
			} else if (item.type === "tabs") {
				for (const tab of (rec.tabs as Array<{
					items: ServerDashboardItem[];
				}>) || []) {
					walk(tab.items || []);
				}
			} else {
				// Widget — assign ID if missing
				if (!rec.id) {
					rec.id = `__auto_${item.type}_${counter++}`;
				}
			}
		}
	}
	walk(items);
}

/**
 * Process dashboard items: evaluate access, strip non-serializable props,
 * mark hasLoader, and filter by collection access.
 */
async function processDashboardItems(
	items: ServerDashboardItem[],
	accessibleCollections: Set<string>,
	accessCtx: { app: App; session?: any; db: any; locale?: string },
): Promise<ServerDashboardItem[]> {
	const result: ServerDashboardItem[] = [];

	for (const item of items) {
		const rec = item as unknown as Record<string, unknown>;

		// Recurse into sections
		if (item.type === "section") {
			const filtered = await processDashboardItems(
				(rec.items as unknown as ServerDashboardItem[]) || [],
				accessibleCollections,
				accessCtx,
			);
			if (filtered.length > 0) {
				result.push({
					...item,
					items: filtered,
				} as unknown as ServerDashboardItem);
			}
			continue;
		}

		// Recurse into tabs
		if (item.type === "tabs") {
			const rawTabs = (rec.tabs as Array<Record<string, unknown>>) || [];
			const tabs = await Promise.all(
				rawTabs.map(async (tab) => {
					const filtered = await processDashboardItems(
						(tab.items as unknown as ServerDashboardItem[]) || [],
						accessibleCollections,
						accessCtx,
					);
					return { ...tab, items: filtered };
				}),
			);
			const visibleTabs = tabs.filter((tab) => tab.items.length > 0);
			if (visibleTabs.length > 0) {
				const { variant: _variant, ...serializableTabs } =
					item as unknown as Record<string, unknown>;
				result.push({
					...serializableTabs,
					tabs: visibleTabs,
				} as unknown as ServerDashboardItem);
			}
			continue;
		}

		// Widget processing — use Record for dynamic property access
		const widget = rec;

		// 1. Check per-widget access
		if (widget.access !== undefined) {
			const widgetAccessResult =
				typeof widget.access === "function"
					? await (widget.access as Function)({
							app: accessCtx.app,
							db: accessCtx.db,
							session: accessCtx.session,
							locale: accessCtx.locale,
						})
					: widget.access;
			if (widgetAccessResult === false) continue;
		}

		// 2. Check collection access for collection-bound widgets
		if (
			widget.collection &&
			!accessibleCollections.has(widget.collection as string)
		) {
			continue;
		}

		// 3. Filter quickActions' individual actions by collection access
		if (widget.type === "quickActions") {
			const actions = (
				(widget.actions as Array<Record<string, any>>) || []
			).filter((action) => {
				if (action.action?.type === "create") {
					return accessibleCollections.has(action.action.collection);
				}
				return true;
			});
			const { loader, access, filterFn, ...serializable } = widget;
			if (loader) {
				(serializable as Record<string, unknown>).hasLoader = true;
			}
			if (serializable.label && !serializable.title) {
				(serializable as Record<string, unknown>).title = serializable.label;
			}
			result.push({
				...serializable,
				actions,
				quickActions: serializable.quickActions ?? actions,
			} as unknown as ServerDashboardItem);
			continue;
		}

		// 4. Strip non-serializable props, mark hasLoader, normalize label->title
		const { loader, access, filterFn, ...serializable } = widget;
		if (loader) {
			(serializable as Record<string, unknown>).hasLoader = true;
		}
		// Normalize: server config uses `label`, client widgets expect `title`
		if (serializable.label && !serializable.title) {
			(serializable as Record<string, unknown>).title = serializable.label;
		}
		result.push(serializable as unknown as ServerDashboardItem);
	}

	return result;
}

// ============================================================================
// Schema Definitions
// ============================================================================

const getAdminConfigSchema = z.object({}).optional();

// Output schema — typed DTO schema with discriminated shapes
const getAdminConfigOutputSchema = adminConfigDTOSchema;

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
 * // In your app
 * const app = runtimeConfig({
 *   modules: [adminModule],
 *   dashboard: ({ d }) => d.dashboard({
 *     title: { en: "Dashboard" },
 *     items: [...],
 *   }))
 *   .sidebar(({ s }) => s.sidebar({
 *     sections: [...],
 *   }))
 *   .build({ ... });
 *
 * // Client fetches config
 * const config = await client.routes.getAdminConfig({});
 * ```
 */
const getAdminConfig = route()
	.post()
	.schema(getAdminConfigSchema)
	.outputSchema(getAdminConfigOutputSchema)
	.handler(async (ctx) => {
		const app = getApp(ctx);
		const appState = getAppState(app);
		const adminCfg = getAdminCfg(app);
		const accessCtx = getAccessContext(ctx);

		// 1. Compute accessible collections and globals
		const collections = app.getCollections();
		const globals = app.getGlobals();

		const [accessibleCollections, accessibleGlobals] = await Promise.all([
			Promise.all(
				Object.entries(collections).map(async ([name, col]) =>
					(await hasReadAccess(getCollectionState(col).access?.read, accessCtx))
						? name
						: null,
				),
			).then((names) => new Set(names.filter(Boolean) as string[])),
			Promise.all(
				Object.entries(globals).map(async ([name, g]) =>
					(await hasReadAccess(getGlobalState(g).access?.read, accessCtx))
						? name
						: null,
				),
			).then((names) => new Set(names.filter(Boolean) as string[])),
		]);

		// 2. Extract and filter metadata
		const allCollectionsMeta = extractCollectionsMeta(app);
		const allGlobalsMeta = extractGlobalsMeta(app);

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
			uploads?: { collections: string[]; defaultCollection?: string };
		} = {};

		const uploadCollections = Object.entries(collections)
			.filter(
				([name, collection]) =>
					accessibleCollections.has(name) &&
					Boolean(getCollectionState(collection).upload),
			)
			.map(([name]) => name);

		response.uploads = {
			collections: uploadCollections,
			defaultCollection:
				uploadCollections.length === 1 ? uploadCollections[0] : undefined,
		};

		// Branding config
		if (adminCfg.branding) {
			response.branding = adminCfg.branding;
		}

		// 3. Dashboard: merge contributions → process access → strip non-serializable
		if (adminCfg.dashboard) {
			let dashboard: ServerDashboardConfig;

			if (isLegacyDashboardConfig(adminCfg.dashboard)) {
				// Legacy: adminCfg.dashboard is already a ServerDashboardConfig (from .dashboard() builder)
				dashboard = adminCfg.dashboard;
			} else {
				// New: adminCfg.dashboard is DashboardContribution[] or mixed
				const contributions = normalizeDashboardContributions(
					adminCfg.dashboard,
				);
				dashboard = mergeDashboardContributions(contributions);
			}

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

		// 4. Sidebar: merge contributions → filter by access → auto-append unlisted
		if (adminCfg.sidebar) {
			let sidebarConfig: ServerSidebarConfig;

			if (isLegacySidebarConfig(adminCfg.sidebar)) {
				// Legacy: adminCfg.sidebar is already a ServerSidebarConfig (from .sidebar() builder)
				sidebarConfig = adminCfg.sidebar;
			} else {
				// New: adminCfg.sidebar is SidebarContribution[] or mixed
				const contributions = normalizeSidebarContributions(adminCfg.sidebar);
				sidebarConfig = mergeSidebarContributions(contributions);
			}

			const filteredSidebar = filterSidebarConfig(
				sidebarConfig,
				accessibleCollections,
				accessibleGlobals,
			);

			// Find collections/globals the user explicitly listed
			const referenced = collectSidebarReferences(sidebarConfig);

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

			const mergedSections = [...filteredSidebar.sections];
			for (const unlistedSection of unlistedSidebar.sections) {
				const existing = mergedSections.find(
					(s) => s.id === unlistedSection.id,
				);
				if (existing) {
					existing.items = [
						...(existing.items ?? []),
						...(unlistedSection.items ?? []),
					];
				} else {
					mergedSections.push(unlistedSection);
				}
			}
			response.sidebar = { sections: mergedSections };
		} else {
			response.sidebar = buildAutoSidebar(
				filteredCollectionsMeta,
				filteredGlobalsMeta,
			);
		}

		// 5. Blocks: unchanged (not access-controlled)
		if (appState.blocks && Object.keys(appState.blocks).length > 0) {
			response.blocks = introspectBlocks(
				appState.blocks as Record<string, any>,
			);
		}

		// 6. Return filtered metadata
		response.collections = filteredCollectionsMeta;
		response.globals = filteredGlobalsMeta;

		return response;
	});

// ============================================================================
// Export Bundle
// ============================================================================

/**
 * Admin config route handlers.
 * Registered via module routes and exposed through the fetch handler.
 */
export const adminConfigFunctions = {
	getAdminConfig,
} as const;
