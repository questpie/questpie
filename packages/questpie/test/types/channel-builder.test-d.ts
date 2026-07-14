import { z } from "zod";

import {
	channel,
	type ChannelEventsOf,
	type ChannelParamsOf,
	type ExtractChannelParams,
} from "#questpie/server/channels/channel-builder.js";
import type { ChannelsService } from "#questpie/server/channels/service.js";

import type { Equal, Expect } from "./type-test-utils.js";

type _params = Expect<
	Equal<
		ExtractChannelParams<"tenant-[tenantId]-room-[roomId]">,
		{ tenantId: string; roomId: string }
	>
>;
type _noParams = Expect<Equal<ExtractChannelParams<"news">, {}>>;

const publicNews = channel("news").events({
	updated: z.object({ id: z.string(), count: z.number() }),
});
const privateRoom = channel("room-[roomId]")
	.events({
		message: z.object({ text: z.string() }),
	})
	.authorize({
		subscribe: ({ params, session }) => {
			const roomId: string = params.roomId;
			const userId: string | undefined = session?.user.id;
			return !!roomId && !!userId;
		},
		publish: ({ params }) => params.roomId === "writeable",
	})
	.presence(({ params, session }) => ({
		id: session!.user.id,
		roomId: params.roomId,
	}));

type _visibilityPublic = Expect<Equal<typeof publicNews.visibility, "public">>;
type _visibilityPresence = Expect<
	Equal<typeof privateRoom.visibility, "presence">
>;
type _roomParams = Expect<
	Equal<ChannelParamsOf<typeof privateRoom>, { roomId: string }>
>;
type _events = Expect<
	Equal<keyof ChannelEventsOf<typeof privateRoom>, "message">
>;

// Presence channels must have a subscribe gate.
// @ts-expect-error presence without authorize is forbidden
channel("public-presence").presence(() => ({ id: "x" }));

type AppChannels = {
	news: typeof publicNews;
	room: typeof privateRoom;
};
declare const channels: ChannelsService<AppChannels>;

channels.publish("news", {
	event: "updated",
	data: { id: "1", count: 1 },
});
channels.publish("room", {
	params: { roomId: "one" },
	event: "message",
	data: { text: "hello" },
});
const presence = channels.resolvePresence("room", { roomId: "one" });
type _presence = Expect<
	Equal<Awaited<typeof presence>, { id: string; roomId: string }>
>;

// @ts-expect-error parametric channel requires params
channels.publish("room", { event: "message", data: { text: "hello" } });
channels.publish("room", {
	// @ts-expect-error unknown param
	params: { room: "one" },
	event: "message",
	data: { text: "hello" },
});
channels.publish("room", {
	params: { roomId: "one" },
	event: "message",
	// @ts-expect-error wrong event payload
	data: { text: 123 },
});
channels.publish("room", {
	params: { roomId: "one" },
	// @ts-expect-error unknown event
	event: "typing",
	data: { text: "hello" },
});
