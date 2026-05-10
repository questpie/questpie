import { ApiError } from "questpie/errors";
import { route } from "questpie/services";
import { z } from "zod";

import {
	toLegacyJoinTokenResponse,
	ttlSeconds,
} from "../../lib/legacy-worker-contract";

const tokenSchema = z.object({
	description: z.string().optional(),
	ttlSeconds: z.number().int().positive().optional(),
	ttl_seconds: z.number().int().positive().optional(),
});

export default route()
	.post()
	.schema(tokenSchema)
	.handler(async (ctx) => {
		if (!ctx.session?.user?.id) {
			throw ApiError.unauthorized(
				"Authentication required to create join tokens",
			);
		}

		return toLegacyJoinTokenResponse(
			await ctx.services.workerManager.createJoinToken({
				description: ctx.input.description,
				ttlSeconds: ttlSeconds(ctx.input),
				createdBy: ctx.session.user.id,
			}),
		);
	});
