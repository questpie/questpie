/**
 * Header Component
 *
 * Responsive header with:
 * - Logo/brand (from CMS)
 * - Desktop navigation (from CMS, localized)
 * - Theme toggle
 * - Locale switcher
 * - Mobile menu (Sheet)
 * - CTA button (from CMS)
 */

import { Check, Globe, List, Moon, Scissors, Sun } from "@phosphor-icons/react";
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
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        {/* Logo */}
        <a href="/" className="flex items-center gap-2 font-bold text-xl">
          {logo ? (
            <img src={logo} alt={shopName} className="h-8 w-auto" />
          ) : (
            <Scissors className="size-6" weight="bold" />
          )}
          <span className="hidden sm:inline">{shopName}</span>
        </a>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-6">
          {navigation.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
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
              <Sun className="size-5" />
            ) : (
              <Moon className="size-5" />
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
              <Globe className="size-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleLocaleChange("en")}>
                <span className="flex items-center gap-2 w-full">
                  {t("language.en")}
                  {locale === "en" && <Check className="size-4 ml-auto" />}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleLocaleChange("sk")}>
                <span className="flex items-center gap-2 w-full">
                  {t("language.sk")}
                  {locale === "sk" && <Check className="size-4 ml-auto" />}
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
              <List className="size-5" />
              <span className="sr-only">{t("common.menu")}</span>
            </SheetTrigger>

            <SheetContent side="right" className="w-[300px] sm:w-[350px]">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {logo ? (
                    <img src={logo} alt={shopName} className="h-6 w-auto" />
                  ) : (
                    <Scissors className="size-5" weight="bold" />
                  )}
                  {shopName}
                </SheetTitle>
              </SheetHeader>

              <nav className="flex flex-col gap-4 mt-8 px-4">
                {navigation.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="block py-2 text-lg font-medium text-foreground hover:text-muted-foreground transition-colors text-left"
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
                  <a href={ctaButtonLink} className="block mt-4">
                    <Button className="bg-highlight text-highlight-foreground hover:bg-highlight/90 w-full">
                      {ctaButtonText}
                    </Button>
                  </a>
                )}
              </nav>

              {/* Mobile footer with theme/locale */}
              <div className="mt-auto p-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t("mobile.theme")}
                  </span>
                  <Button variant="outline" size="sm" onClick={toggleTheme}>
                    {resolvedTheme === "dark" ? (
                      <>
                        <Sun className="size-4 mr-2" />
                        {t("theme.light")}
                      </>
                    ) : (
                      <>
                        <Moon className="size-4 mr-2" />
                        {t("theme.dark")}
                      </>
                    )}
                  </Button>
                </div>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-sm text-muted-foreground">
                    {t("mobile.language")}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<Button variant="outline" size="sm" />}
                    >
                      <Globe className="size-4 mr-2" />
                      {locale === "en" ? t("language.en") : t("language.sk")}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => handleLocaleChange("en")}
                      >
                        <span className="flex items-center gap-2 w-full">
                          {t("language.en")}
                          {locale === "en" && (
                            <Check className="size-4 ml-auto" />
                          )}
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleLocaleChange("sk")}
                      >
                        <span className="flex items-center gap-2 w-full">
                          {t("language.sk")}
                          {locale === "sk" && (
                            <Check className="size-4 ml-auto" />
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
