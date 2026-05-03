import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { app } from "#questpie";
import { createRequestContext } from "@/lib/server-helpers";

export type SiteSettingsData = Awaited<
	ReturnType<typeof app.globals.site_settings.get>
>;

const localeInputSchema = z
	.object({ locale: z.string().optional() })
	.optional();

export const getSiteSettings = createServerFn({ method: "GET" })
	.inputValidator((data) => localeInputSchema.parse(data))
	.handler(async ({ data }) => {
		const ctx = await createRequestContext(data?.locale);

		const settings = await app.globals.site_settings.get(
			{ with: { logo: true } },
			ctx,
		);

		return settings;
	});
