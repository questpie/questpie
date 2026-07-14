import { route } from "#questpie/server/routes/define-route.js";

import {
	channelRouteError,
	channelRouteResponse,
	consumeChannelPublishQuota,
	parseChannelPublishRequest,
	requestChannels,
	validateChannelRouteOrigin,
} from "./_shared.js";

/** Server-mediated, schema-validated client publish path for every preset. */
export default route()
	.post()
	.access(true)
	.raw()
	.handler(async (ctx) => {
		let origin: string | null = null;
		try {
			origin = validateChannelRouteOrigin(ctx);
			const input = await parseChannelPublishRequest(ctx.request);
			const channels = requestChannels(ctx);
			const prepared = await channels.preparePublish(input.channel, {
				params: input.params,
				event: input.event,
				data: input.data,
			} as any);
			const quota = consumeChannelPublishQuota(ctx, ctx.request);
			if (!quota.allowed) {
				const response = channelRouteResponse(
					{
						error: "channel_publish_rate_limited",
						retryAfterMs: quota.retryAfterMs,
					},
					429,
					origin,
				);
				response.headers.set(
					"Retry-After",
					String(Math.max(1, Math.ceil(quota.retryAfterMs / 1000))),
				);
				return response;
			}
			const receipt = await channels.publishPrepared(prepared);
			return channelRouteResponse(receipt, 200, origin);
		} catch (error) {
			if (error instanceof Error && "status" in error) {
				const status = Number((error as { status: unknown }).status);
				return channelRouteResponse(
					{
						error:
							status === 415
								? "channel_content_type_invalid"
								: "channel_request_invalid",
					},
					status,
					origin,
				);
			}
			return channelRouteError(error, origin);
		}
	});
