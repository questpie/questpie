import { createStore, useStore } from "zustand";
import { useShallow } from "zustand/shallow";

import { useAdminStoreRaw } from "../runtime/provider.js";
import type { BrandLogoConfig } from "../types/admin-config.js";

export interface BrandSnapshot {
	name: string;
	logo: BrandLogoConfig | null;
	tagline: string | null;
	favicon: string | null;
}

const DEFAULT_BRAND: BrandSnapshot = {
	name: "Admin",
	logo: null,
	tagline: null,
	favicon: null,
};

const FALLBACK_STORE = createStore(() => ({
	brandName: DEFAULT_BRAND.name,
	brandLogo: DEFAULT_BRAND.logo,
	brandTagline: DEFAULT_BRAND.tagline,
	brandFavicon: DEFAULT_BRAND.favicon,
}));

function selectBrand(state: {
	brandName: string;
	brandLogo: BrandLogoConfig | null;
	brandTagline: string | null;
	brandFavicon: string | null;
}): BrandSnapshot {
	return {
		name: state.brandName,
		logo: state.brandLogo,
		tagline: state.brandTagline,
		favicon: state.brandFavicon,
	};
}

/**
 * Read branding fields from the admin store. Safe to call outside of an
 * `<AdminProvider>` — falls back to the default snapshot when no store is
 * mounted (e.g. on a bare auth page).
 */
export function useBrand(): BrandSnapshot {
	const store = useAdminStoreRaw();
	return useStore(store ?? FALLBACK_STORE, useShallow(selectBrand));
}

/**
 * Imperative variant for code paths that cannot use hooks (callbacks,
 * server-side helpers). Returns null when no provider is mounted.
 */
export function useBrandSnapshotRef(): BrandSnapshot | null {
	const store = useAdminStoreRaw();
	if (!store) return null;
	return selectBrand(store.getState());
}
