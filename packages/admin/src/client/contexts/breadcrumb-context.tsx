import * as React from "react";

import type { I18nText } from "../i18n/types";

// ============================================================================
// Types
// ============================================================================

/**
 * Simple icon component type for breadcrumbs
 */
type BreadcrumbIcon = React.ComponentType<{ className?: string }>;

/**
 * Menu item for breadcrumb dropdown
 */
export interface BreadcrumbMenuItem {
	label: I18nText;
	href: string;
	icon?: BreadcrumbIcon;
}

/**
 * Single breadcrumb item
 */
export interface Breadcrumb {
	/**
	 * Display label (supports I18nText for localization)
	 */
	label: I18nText;

	/**
	 * Navigation href (optional - last item usually doesn't have one)
	 */
	href?: string;

	/**
	 * Icon component (optional)
	 */
	icon?: BreadcrumbIcon;

	/**
	 * Dropdown menu items for quick navigation
	 * e.g., switch between collections or items
	 */
	menu?: {
		items: BreadcrumbMenuItem[];
	};
}

/**
 * Breadcrumb context value
 */
interface BreadcrumbContextValue {
	breadcrumbs: Breadcrumb[];
	setBreadcrumbs: (breadcrumbs: Breadcrumb[]) => void;
}

// ============================================================================
// Context
// ============================================================================

const BreadcrumbContext = React.createContext<BreadcrumbContextValue | null>(
	null,
);

// ============================================================================
// Provider
// ============================================================================

interface BreadcrumbProviderProps {
	children: React.ReactNode;
}

export function BreadcrumbProvider({
	children,
}: BreadcrumbProviderProps): React.ReactElement {
	const [breadcrumbs, setBreadcrumbs] = React.useState<Breadcrumb[]>([]);

	const value = React.useMemo(
		() => ({
			breadcrumbs,
			setBreadcrumbs,
		}),
		[breadcrumbs],
	);

	return (
		<BreadcrumbContext.Provider value={value}>
			{children}
		</BreadcrumbContext.Provider>
	);
}

/**
 * Get breadcrumb context (optional - returns null if not in provider)
 */
function useBreadcrumbContextOptional(): BreadcrumbContextValue | null {
	return React.useContext(BreadcrumbContext);
}

/**
 * Get current breadcrumbs (read-only)
 */
export function useCurrentBreadcrumbs(): Breadcrumb[] {
	const context = useBreadcrumbContextOptional();
	return context?.breadcrumbs ?? [];
}
