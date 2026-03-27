/**
 * Header Component
 *
 * Responsive header with:
 * - Logo/brand (from app)
 * - Desktop navigation (from app, localized)
 * - Theme toggle
 * - Locale switcher
 * - Mobile menu (Sheet)
 * - CTA button (from app)
 */

import { Icon } from "@iconify/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import {
	type Locale,
	useLocale,
	useTranslation,
} from "@/lib/providers/locale-provider";
import { useTheme } from "@/lib/providers/theme-provider";

// Types matching site-settings global
export interface NavItem {
	label: string;
	href: string;
	isExternal?: boolean;
}

export interface HeaderProps {
	shopName?: string;
	logo?: string; // Asset URL
	navigation?: NavItem[];
	ctaButtonText?: string;
	ctaButtonLink?: string;
}

export function Header({
	shopName = "Sharp Cuts",
	logo,
	navigation = [],
	ctaButtonText,
	ctaButtonLink = "/booking",
}: HeaderProps) {
	const { locale, setLocale, t } = useLocale();
	const { setTheme, resolvedTheme } = useTheme();
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
	const router = useRouter();

	const toggleTheme = () => {
		setTheme(resolvedTheme === "dark" ? "light" : "dark");
	};

	const handleLocaleChange = (newLocale: Locale) => {
		setLocale(newLocale);
		// Refresh router to reload data with new locale
		router.invalidate();
	};

	return (
		<header className="border-border bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40 w-full border-b backdrop-blur">
			<div className="container flex h-16 items-center justify-between">
				{/* Logo */}
				<a href="/" className="flex items-center gap-2 text-xl font-bold">
					{logo ? (
						<img src={logo} alt={shopName} className="h-8 w-auto" />
					) : (
						<Icon icon="ph:scissors-bold" className="size-6" />
					)}
					<span className="hidden sm:inline">{shopName}</span>
				</a>

				{/* Desktop Navigation */}
				<nav className="hidden items-center gap-6 md:flex">
					{navigation.map((item) => (
						<a
							key={item.href}
							href={item.href}
							className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
							{...(item.isExternal && {
								target: "_blank",
								rel: "noopener noreferrer",
							})}
						>
							{item.label}
						</a>
					))}
				</nav>

				{/* Right side actions */}
				<div className="flex items-center gap-2">
					{/* Theme Toggle */}
					<Button
						variant="ghost"
						size="icon"
						onClick={toggleTheme}
						aria-label={t("theme.toggle")}
					>
						{resolvedTheme === "dark" ? (
							<Icon icon="ph:sun" className="size-5" />
						) : (
							<Icon icon="ph:moon" className="size-5" />
						)}
					</Button>

					{/* Locale Switcher */}
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button
									variant="ghost"
									size="icon"
									aria-label={t("language.switch")}
								/>
							}
						>
							<Icon icon="ph:globe" className="size-5" />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={() => handleLocaleChange("en")}>
								<span className="flex w-full items-center gap-2">
									{t("language.en")}
									{locale === "en" && (
										<Icon icon="ph:check" className="ml-auto size-4" />
									)}
								</span>
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => handleLocaleChange("sk")}>
								<span className="flex w-full items-center gap-2">
									{t("language.sk")}
									{locale === "sk" && (
										<Icon icon="ph:check" className="ml-auto size-4" />
									)}
								</span>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>

					{/* Book Now CTA - Desktop */}
					{ctaButtonText && (
						<a href={ctaButtonLink} className="hidden sm:block">
							<Button className="bg-highlight text-highlight-foreground hover:bg-highlight/90">
								{ctaButtonText}
							</Button>
						</a>
					)}

					{/* Mobile Menu */}
					<Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
						<SheetTrigger
							render={
								<Button variant="ghost" size="icon" className="md:hidden" />
							}
						>
							<Icon icon="ph:list" className="size-5" />
							<span className="sr-only">{t("common.menu")}</span>
						</SheetTrigger>

						<SheetContent side="right" className="w-[300px] sm:w-[350px]">
							<SheetHeader>
								<SheetTitle className="flex items-center gap-2">
									{logo ? (
										<img src={logo} alt={shopName} className="h-6 w-auto" />
									) : (
										<Icon icon="ph:scissors-bold" className="size-5" />
									)}
									{shopName}
								</SheetTitle>
							</SheetHeader>

							<nav className="mt-8 flex flex-col gap-4 px-4">
								{navigation.map((item) => (
									<a
										key={item.href}
										href={item.href}
										className="text-foreground hover:text-muted-foreground block py-2 text-left text-lg font-medium transition-colors"
										onClick={() => setMobileMenuOpen(false)}
										{...(item.isExternal && {
											target: "_blank",
											rel: "noopener noreferrer",
										})}
									>
										{item.label}
									</a>
								))}

								{/* Book Now - Mobile */}
								{ctaButtonText && (
									<a href={ctaButtonLink} className="mt-4 block">
										<Button className="bg-highlight text-highlight-foreground hover:bg-highlight/90 w-full">
											{ctaButtonText}
										</Button>
									</a>
								)}
							</nav>

							{/* Mobile footer with theme/locale */}
							<div className="border-border mt-auto border-t p-4">
								<div className="flex items-center justify-between">
									<span className="text-muted-foreground text-sm">
										{t("mobile.theme")}
									</span>
									<Button variant="outline" size="sm" onClick={toggleTheme}>
										{resolvedTheme === "dark" ? (
											<>
												<Icon icon="ph:sun" className="mr-2 size-4" />
												{t("theme.light")}
											</>
										) : (
											<>
												<Icon icon="ph:moon" className="mr-2 size-4" />
												{t("theme.dark")}
											</>
										)}
									</Button>
								</div>
								<div className="mt-3 flex items-center justify-between">
									<span className="text-muted-foreground text-sm">
										{t("mobile.language")}
									</span>
									<DropdownMenu>
										<DropdownMenuTrigger
											render={<Button variant="outline" size="sm" />}
										>
											<Icon icon="ph:globe" className="mr-2 size-4" />
											{locale === "en" ? t("language.en") : t("language.sk")}
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end">
											<DropdownMenuItem
												onClick={() => handleLocaleChange("en")}
											>
												<span className="flex w-full items-center gap-2">
													{t("language.en")}
													{locale === "en" && (
														<Icon icon="ph:check" className="ml-auto size-4" />
													)}
												</span>
											</DropdownMenuItem>
											<DropdownMenuItem
												onClick={() => handleLocaleChange("sk")}
											>
												<span className="flex w-full items-center gap-2">
													{t("language.sk")}
													{locale === "sk" && (
														<Icon icon="ph:check" className="ml-auto size-4" />
													)}
												</span>
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								</div>
							</div>
						</SheetContent>
					</Sheet>
				</div>
			</div>
		</header>
	);
}
