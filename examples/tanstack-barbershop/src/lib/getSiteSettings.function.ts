import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { app } from "#questpie";
import { createRequestContext } from "@/lib/server-helpers";

/** Resolved site settings as returned by getSiteSettings (logo populated). */
export type SiteSettingsData = Awaited<ReturnType<typeof getSiteSettings>>;

const localeInputSchema = z
	.object({ locale: z.string().optional() })
	.optional();

export const getSiteSettings = createServerFn({ method: "GET" })
	.validator((data) => localeInputSchema.parse(data))
	.handler(async ({ data }) => {
		const ctx = await createRequestContext(data?.locale);

		const settings = await app.globals.site_settings.get(
			{ with: { logo: true } },
			ctx,
		);
		if (!settings) {
			throw new Error("site_settings global is not available");
		}

		return settings;
	});
