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
			// The only construction site that does NOT go through
			// `createChannelServiceContext`: the service-create context already
			// carries the full surface (collections, globals, db, ...), and folding
			// it again would re-enter `resolveService("channels")` from inside its
			// own factory.
			ctx as ChannelServiceContext,
			app.config.realtime?.channelSecurity,
		);
	},
});
