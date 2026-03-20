import { Icon } from "@iconify/react";
import * as React from "react";

import { Button } from "../../components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Kbd } from "../../components/ui/kbd";
import { SidebarTrigger } from "../../components/ui/sidebar";
import type { Breadcrumb } from "../../contexts/breadcrumb-context";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { cn } from "../../lib/utils";

type Theme = "light" | "dark" | "system";

// Module-level constant for empty array to avoid recreating on each render
const EMPTY_BREADCRUMBS: Breadcrumb[] = [];

interface AdminTopbarProps {
	onSearchOpen: () => void;
	breadcrumbs?: Breadcrumb[];
	theme?: Theme;
	setTheme?: (theme: Theme) => void;
	showThemeToggle?: boolean;
}

export const AdminTopbar = React.memo(function AdminTopbar({
	onSearchOpen,
	breadcrumbs,
	theme: _theme = "system",
	setTheme,
	showThemeToggle,
}: AdminTopbarProps) {
	const resolvedBreadcrumbs = breadcrumbs ?? EMPTY_BREADCRUMBS;
	const resolveText = useResolveText();
	const { t } = useTranslation();

	// Show theme toggle if setTheme is provided and showThemeToggle is not explicitly false
	const shouldShowThemeToggle = setTheme && showThemeToggle !== false;

	return (
		<header
			role="banner"
			className="qa-topbar border-border bg-background relative sticky top-0 z-30 flex h-14 w-full items-center justify-between border-b px-4 md:px-6"
		>
			<div className="qa-topbar__left flex items-center gap-2">
				{/* Sidebar toggle - works for both mobile (opens sheet) and desktop (collapses) */}
				<SidebarTrigger />

				{/* Mobile: show current page title */}
				{resolvedBreadcrumbs.length > 0 && (
					<span className="qa-topbar__mobile-title text-foreground max-w-[140px] truncate font-mono text-xs font-medium md:hidden">
						{resolveText(
							resolvedBreadcrumbs[resolvedBreadcrumbs.length - 1].label,
						)}
					</span>
				)}

				{/* Breadcrumbs */}
				<nav
					aria-label="Breadcrumb"
					className="qa-topbar__breadcrumbs text-muted-foreground hidden items-center gap-1.5 font-mono text-xs md:flex"
				>
					{resolvedBreadcrumbs.map((crumb) => {
						const CrumbIcon = crumb.icon;
						const crumbLabel = resolveText(crumb.label);
						const crumbKey = crumb.href ?? crumbLabel;
						return (
							<React.Fragment key={crumbKey}>
								{resolvedBreadcrumbs[0] !== crumb && (
									<span className="qa-topbar__breadcrumb-separator text-muted-foreground/40 mx-1">
										/
									</span>
								)}

								{crumb.menu ? (
									// Breadcrumb with dropdown menu
									<DropdownMenu>
										<DropdownMenuTrigger
											render={
												<button
													type="button"
													className={cn(
														"qa-topbar__breadcrumb-item hover:text-foreground flex items-center gap-1 transition-colors",
														resolvedBreadcrumbs[
															resolvedBreadcrumbs.length - 1
														] === crumb && "text-foreground font-medium",
													)}
												>
													{CrumbIcon && <CrumbIcon className="size-3.5" />}
													{crumbLabel}
													<Icon
														icon="ph:caret-down"
														className="size-3 opacity-50"
													/>
												</button>
											}
										/>
										<DropdownMenuContent align="start">
											{crumb.menu.items.map((item) => {
												const ItemIcon = item.icon;
												return (
													<DropdownMenuItem
														key={item.href}
														onClick={() => {
															window.location.href = item.href;
														}}
													>
														{ItemIcon && <ItemIcon className="size-3.5" />}
														{resolveText(item.label)}
													</DropdownMenuItem>
												);
											})}
										</DropdownMenuContent>
									</DropdownMenu>
								) : crumb.href ? (
									// Breadcrumb with link
									<a
										href={crumb.href}
										className="qa-topbar__breadcrumb-item hover:text-foreground flex items-center gap-1.5 transition-colors"
									>
										{CrumbIcon && <CrumbIcon className="size-3.5" />}
										{crumbLabel}
									</a>
								) : (
									// Static breadcrumb (current page)
									<span
										className={cn(
											"qa-topbar__breadcrumb-item flex items-center gap-1.5",
											resolvedBreadcrumbs[resolvedBreadcrumbs.length - 1] ===
												crumb
												? "text-foreground font-medium"
												: "",
										)}
										aria-current={
											resolvedBreadcrumbs[resolvedBreadcrumbs.length - 1] ===
											crumb
												? "page"
												: undefined
										}
									>
										{CrumbIcon && <CrumbIcon className="size-3.5" />}
										{crumbLabel}
									</span>
								)}
							</React.Fragment>
						);
					})}
				</nav>
			</div>

			<div className="qa-topbar__right flex items-center gap-2">
				<Button
					variant="outline"
					onClick={onSearchOpen}
					size="icon-sm"
					className="qa-topbar__search-btn text-muted-foreground gap-2 md:size-auto md:h-9 md:w-64 md:justify-between md:px-3"
					aria-label={t("ui.searchPlaceholder")}
				>
					<span className="flex items-center gap-2">
						<Icon icon="ph:magnifying-glass" />
						<span className="hidden md:inline">
							{t("ui.searchPlaceholder")}
						</span>
					</span>
					<Kbd className="hidden md:inline-flex">
						<span className="text-xs">⌘</span>K
					</Kbd>
				</Button>

				{shouldShowThemeToggle && (
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button
									variant="ghost"
									size="icon"
									className="qa-topbar__theme-toggle"
								>
									<Icon
										icon="ph:sun"
										className="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90"
									/>
									<Icon
										icon="ph:moon"
										className="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0"
									/>
									<span className="sr-only">{t("ui.toggleTheme")}</span>
								</Button>
							}
						/>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={() => setTheme("light")}>
								<Icon icon="ph:sun" className="mr-2 size-4" />
								{t("ui.themeLight")}
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => setTheme("dark")}>
								<Icon icon="ph:moon" className="mr-2 size-4" />
								{t("ui.themeDark")}
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => setTheme("system")}>
								<Icon icon="ph:monitor" className="mr-2 size-4" />
								{t("ui.themeSystem")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</div>
		</header>
	);
});
