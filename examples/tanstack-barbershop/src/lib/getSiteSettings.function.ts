import { createServerFn } from "@tanstack/react-start";
import { app } from "#questpie";
import { createRequestContext } from "@/lib/server-helpers";

export type SiteSettingsData = Awaited<
	ReturnType<typeof app.api.globals.site_settings.get>
>;

export const getSiteSettings = createServerFn({ method: "GET" })
	.inputValidator((data: { locale?: string }) => data)
	.handler(async ({ data }) => {
		const ctx = await createRequestContext(data?.locale);

		const settings = await app.api.globals.site_settings.get(
			{ with: { logo: true } },
			ctx,
		);

		return settings;
	});
