import type { ChannelDefinitions } from "#questpie/server/channels/channel-builder.js";
import {
	type ChannelServiceContext,
	ChannelsService,
} from "#questpie/server/channels/service.js";
import type { QuestpieConfig } from "#questpie/server/config/types.js";
import { service } from "#questpie/server/services/define-service.js";

/** Request-bound typed channels facade backed by the singleton realtime service. */
export default service({
	namespace: null,
	lifecycle: "request",
	create: (ctx) => {
		const { app } = ctx;
		const config = app.config as QuestpieConfig & {
			channels?: ChannelDefinitions;
		};
		return new ChannelsService(
			config.channels ?? {},
			app.realtime,
			ctx as ChannelServiceContext,
		);
	},
});
