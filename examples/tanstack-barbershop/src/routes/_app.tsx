/**
 * App Layout Route
 *
 * Main layout for the barbershop frontend.
 * Features:
 * - Fetches site settings from CMS
 * - Provides theme and locale context
 * - Renders Header and Footer with CMS data
 * - Child routes rendered via <Outlet />
 */

import { TanStackDevtools } from "@tanstack/react-devtools";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createFileRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import {
  type BusinessHours,
  Footer,
  type SocialLink,
} from "../components/layout/Footer";
import { Header } from "../components/layout/Header";
import {
  getSiteSettings,
  type SiteSettingsData,
} from "../lib/getSiteSettings.function";
import { LocaleProvider } from "../lib/providers/locale-provider";
import { ThemeProvider } from "../lib/providers/theme-provider";
import { queryClient } from "../lib/query-client";
import stylesCss from "../styles.css?url";

export const Route = createFileRoute("/_app")({
  loader: async () => {
    // Fetch site settings for layout
    const siteSettings = (await getSiteSettings({
      data: { locale: undefined },
    })) as SiteSettingsData;
    return { siteSettings };
  },

  head: ({ loaderData }) => {
    const settings = loaderData?.siteSettings;
    return {
      title: settings?.metaTitle || "Sharp Cuts - Premium Barbershop",
      meta: settings?.metaDescription
        ? [{ name: "description", content: settings.metaDescription }]
        : [],
      links: [{ rel: "stylesheet", href: stylesCss }],
    };
  },

  component: AppLayout,
});

function AppLayout() {
  const { siteSettings } = Route.useLoaderData();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Inline script to prevent FOUC for theme */}
        <script
          // biome-ignore lint: theme pre-hydration
          dangerouslySetInnerHTML={{
            __html: `
							(function() {
								const theme = localStorage.getItem('barbershop-theme');
								const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
								const resolvedTheme = theme === 'system' || !theme
									? (prefersDark ? 'dark' : 'light')
									: theme;
								document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
							})();
						`,
          }}
        />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <LocaleProvider>
              <div className="flex min-h-screen flex-col">
                <Header
                  shopName={siteSettings.shopName}
                  logo={siteSettings.logo || undefined}
                  navigation={siteSettings.navigation ?? []}
                  ctaButtonText={siteSettings.ctaButtonText || undefined}
                  ctaButtonLink={siteSettings.ctaButtonLink || undefined}
                />

                <main className="flex-1">
                  <Outlet />
                </main>

                <Footer
                  shopName={siteSettings.shopName}
                  tagline={siteSettings.footerTagline || undefined}
                  footerLinks={siteSettings.footerLinks ?? []}
                  socialLinks={(siteSettings.socialLinks ?? []) as SocialLink[]}
                  businessHours={
                    siteSettings.businessHours as BusinessHours | undefined
                  }
                  contactEmail={siteSettings.contactEmail}
                  contactPhone={siteSettings.contactPhone || undefined}
                  address={siteSettings.address || undefined}
                  city={siteSettings.city || undefined}
                  zipCode={siteSettings.zipCode || undefined}
                  country={siteSettings.country || undefined}
                  copyrightText={siteSettings.copyrightText || undefined}
                />
              </div>
            </LocaleProvider>
          </ThemeProvider>

          {process.env.NODE_ENV === "development" && (
            <TanStackDevtools
              config={{
                position: "bottom-right",
              }}
              plugins={[
                {
                  name: "Tanstack Router",
                  render: <TanStackRouterDevtoolsPanel />,
                },
              ]}
            />
          )}
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
