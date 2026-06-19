import { Icon } from "@iconify/react";
import * as React from "react";

import { Button } from "../../components/ui/button";
import { SidebarTrigger } from "../../components/ui/sidebar";
import {
	type Breadcrumb,
	useCurrentBreadcrumbs,
} from "../../contexts/breadcrumb-context";
import { useResolveText, useSafeI18n } from "../../i18n/hooks";

interface AdminTopbarProps {
	/** Opens the global admin search. */
	onSearchOpen: () => void;
	/**
	 * Breadcrumb trail for the current page. Defaults to the active
	 * breadcrumbs from `BreadcrumbProvider`; the last entry is used as the
	 * mobile page title.
	 */
	breadcrumbs?: Breadcrumb[];
}

/**
 * AdminTopbar — persistent mobile-only header.
 *
 * Renders below 768px (md:hidden) as the first child of the content area so the
 * navigation Sheet can always be reopened (the in-Sheet trigger disappears with
 * the Sheet) and global search has a reachable entry point on a phone. On
 * desktop the sidebar owns these controls, so this header is hidden.
 */
export const AdminTopbar = React.memo(function AdminTopbar({
	onSearchOpen,
	breadcrumbs,
}: AdminTopbarProps) {
	const contextBreadcrumbs = useCurrentBreadcrumbs();
	const resolvedBreadcrumbs = breadcrumbs ?? contextBreadcrumbs;
	const resolveText = useResolveText();
	const i18n = useSafeI18n();
	const searchLabel = (() => {
		const message = i18n?.t("ui.searchPlaceholder");
		return message && message !== "ui.searchPlaceholder" ? message : "Search";
	})();

	const currentCrumb =
		resolvedBreadcrumbs.length > 0
			? resolvedBreadcrumbs[resolvedBreadcrumbs.length - 1]
			: undefined;
	const title = currentCrumb ? resolveText(currentCrumb.label) : "";

	return (
		<header
			role="banner"
			className="qa-topbar border-border-subtle bg-background/95 sticky top-0 z-50 flex h-14 w-full shrink-0 items-center gap-1 border-b px-2 backdrop-blur md:hidden"
		>
			{/* Sidebar toggle — reopens the nav Sheet on mobile */}
			<SidebarTrigger className="size-11" />

			{/* Current page title */}
			<span className="qa-topbar__title font-chrome text-foreground min-w-0 flex-1 truncate text-sm font-medium">
				{title}
			</span>

			{/* Global search entry point */}
			<Button
				variant="ghost"
				size="icon"
				onClick={onSearchOpen}
				className="qa-topbar__search-btn text-muted-foreground hover:text-foreground size-11 shrink-0"
				aria-label={searchLabel}
			>
				<Icon icon="ph:magnifying-glass" />
			</Button>
		</header>
	);
});
