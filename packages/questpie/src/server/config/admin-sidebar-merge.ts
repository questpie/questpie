import type { MergeFn } from "#questpie/server/config/create-app.js";

function mergeDeepConcatLocal(a: Record<string, unknown>, b: Record<string, unknown>) {
	const result: Record<string, unknown> = { ...a };
	for (const [key, value] of Object.entries(b)) {
		if (Array.isArray(result[key]) && Array.isArray(value)) {
			result[key] = [...(result[key] as unknown[]), ...value];
		} else if (
			result[key] !== undefined &&
			typeof result[key] === "object" &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			!Array.isArray(result[key])
		) {
			result[key] = {
				...(result[key] as Record<string, unknown>),
				...(value as Record<string, unknown>),
			};
		} else {
			result[key] = value;
		}
	}
	return result;
}

/**
 * App-defined sidebar with items nested inside sections (not contribution `items[]`).
 * When present on the incoming config, module sidebar contributions are not merged in.
 */
export function isAuthoritativeSidebar(sidebar: unknown): boolean {
	if (!sidebar || typeof sidebar !== "object" || Array.isArray(sidebar)) {
		return false;
	}

	const sections = (sidebar as Record<string, unknown>).sections;
	if (!Array.isArray(sections)) {
		return false;
	}

	return sections.some((section) => {
		if (!section || typeof section !== "object") return false;
		const items = (section as Record<string, unknown>).items;
		return Array.isArray(items) && items.length > 0;
	});
}

/** Merge admin sidebar config: append contributions unless app config is authoritative. */
export const mergeAdminSidebar: MergeFn = (existing, incoming) => {
	if (!existing) return incoming;
	if (!incoming) return existing;
	if (isAuthoritativeSidebar(incoming)) {
		return incoming;
	}
	return mergeDeepConcatLocal(
		existing as Record<string, unknown>,
		incoming as Record<string, unknown>,
	);
};

export type AdminSidebarMode = "append" | "replace";

/**
 * Merge `config.admin` bucket entries.
 * `sidebarMode: "replace"` keeps only the app's sidebar; default appends module items.
 */
export function mergeAdminConfig(
	existing: Record<string, unknown> | undefined,
	incoming: Record<string, unknown> | undefined,
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...(existing || {}) };
	const sidebarMode =
		(incoming?.sidebarMode as AdminSidebarMode | undefined) ??
		(result.sidebarMode as AdminSidebarMode | undefined) ??
		"append";

	if (incoming?.sidebarMode !== undefined) {
		result.sidebarMode = incoming.sidebarMode;
	}

	for (const [key, value] of Object.entries(incoming || {})) {
		if (key === "sidebarMode") continue;

		if (key === "sidebar") {
			if (sidebarMode === "replace") {
				result.sidebar = value;
			} else if (result.sidebar !== undefined) {
				result.sidebar = mergeAdminSidebar(result.sidebar, value);
			} else {
				result.sidebar = value;
			}
			continue;
		}

		if (
			result[key] !== undefined &&
			typeof result[key] === "object" &&
			typeof value === "object" &&
			!Array.isArray(result[key]) &&
			!Array.isArray(value) &&
			key === "dashboard"
		) {
			result[key] = mergeDeepConcatLocal(
				result[key] as Record<string, unknown>,
				value as Record<string, unknown>,
			);
			continue;
		}

		result[key] = value;
	}

	return result;
}

/** Whether getAdminConfig should auto-append unlisted collections/globals. */
export function shouldAutoAppendUnlistedSidebar(
	adminConfig: Record<string, unknown> | undefined,
	sidebarConfig: unknown,
): boolean {
	const sidebarMode = adminConfig?.sidebarMode as AdminSidebarMode | undefined;
	if (sidebarMode === "replace") {
		return false;
	}
	return !isAuthoritativeSidebar(sidebarConfig);
}
