import {
	type ChannelServiceContext,
	ChannelsService,
} from "#questpie/server/channels/service.js";
import { service } from "#questpie/server/services/define-service.js";

/** Request-bound typed channels facade backed by the singleton realtime service. */
export default service({
	namespace: null,
	lifecycle: "request",
	create: (ctx) => {
		const { app } = ctx;
		return new ChannelsService(
			app.config.channels ?? {},
			app.realtime,
			ctx as ChannelServiceContext,
			app.config.realtime?.channelSecurity,
		);
	},
});
