/**
 * Server function to fetch site settings
 *
 * Used by layout to get navigation, footer links, business hours, etc.
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { cms } from "../questpie/server/cms";

function getLocaleFromCookie(cookieHeader?: string): "en" | "sk" {
  if (!cookieHeader) return "en";
  const match = cookieHeader.match(/barbershop-locale=([^;]+)/);
  return match?.[1] === "sk" ? "sk" : "en";
}

export type SiteSettingsData = Awaited<
  ReturnType<typeof cms.api.globals.siteSettings.get>
>;

export const getSiteSettings = createServerFn({ method: "GET" })
  .inputValidator((data: { locale?: string }) => data)
  .handler(async ({ data }) => {
    const headers = getRequestHeaders();
    const cookie = headers.get("cookie");
    const locale = data?.locale || getLocaleFromCookie(cookie || undefined);

    const settings = await cms.api.globals.siteSettings.get({
      locale,
      with: { logo: true },
    });

    return settings as any;
  });
