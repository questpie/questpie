import { createServerFn } from "@tanstack/react-start";

import { app } from "#questpie";
import { createRequestContext } from "@/lib/server-helpers";

export const getAllServices = createServerFn({ method: "GET" })
	.inputValidator((data: { locale?: string } | undefined) => data)
	.handler(async ({ data }) => {
		const ctx = await createRequestContext(data?.locale);

		const result = await app.collections.services.find(
			{
				where: { isActive: true },
				orderBy: { price: "asc" },
				with: { image: true },
			},
			ctx,
		);

		return {
			services: result.docs.map((s) => ({
				id: s.id,
				name: s.name,
				description: s.description,
				price: s.price,
				duration: s.duration,
				image: s.image
					? {
							url: s.image.url,
							alt: s.image.alt,
							width: s.image.width,
							height: s.image.height,
						}
					: null,
			})),
		};
	});
