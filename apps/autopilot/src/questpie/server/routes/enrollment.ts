import { ApiError } from "questpie/errors";
import { route } from "questpie/services";
import { z } from "zod";

const enrollmentSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("createToken"),
		description: z.string().optional(),
		ttlSeconds: z
			.number()
			.int()
			.positive()
			.max(60 * 60 * 24 * 30)
			.optional(),
	}),
	z.object({
		action: z.literal("enroll"),
		token: z.string().min(1),
		name: z.string().min(1),
		deviceId: z.string().min(1),
		capabilities: z.unknown().optional(),
	}),
]);

export default route()
	.post()
	.schema(enrollmentSchema)
	.handler(async (ctx) => {
		if (ctx.input.action === "enroll") {
			return {
				action: "enrolled" as const,
				...(await ctx.services.workerManager.enroll(ctx.input)),
			};
		}

		if (!ctx.session?.user?.id) {
			throw ApiError.unauthorized(
				"Authentication required to create join tokens",
			);
		}

		const token = await ctx.services.workerManager.createJoinToken({
			description: ctx.input.description,
			ttlSeconds: ctx.input.ttlSeconds,
			createdBy: ctx.session.user.id,
		});

		return { action: "joinToken.created" as const, ...token };
	});
