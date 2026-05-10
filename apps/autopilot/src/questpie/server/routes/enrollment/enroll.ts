import { ApiError } from "questpie/errors";
import { route } from "questpie/services";
import { z } from "zod";

import {
	snakeDeviceId,
	toLegacyEnrollmentResponse,
} from "../../lib/legacy-worker-contract";

const enrollSchema = z.object({
	token: z.string().min(1),
	name: z.string().min(1),
	deviceId: z.string().min(1).optional(),
	device_id: z.string().min(1).optional(),
	capabilities: z.unknown().optional(),
});

export default route()
	.post()
	.schema(enrollSchema)
	.handler(async (ctx) => {
		const deviceId = snakeDeviceId(ctx.input);
		if (!deviceId) {
			throw ApiError.badRequest("device_id is required");
		}

		return toLegacyEnrollmentResponse(
			await ctx.services.workerManager.enroll({
				token: ctx.input.token,
				name: ctx.input.name,
				deviceId,
				capabilities: ctx.input.capabilities,
			}),
		);
	});
