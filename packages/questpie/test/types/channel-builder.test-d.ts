import { z } from "zod";

import {
	channel,
	type ChannelEventsOf,
	type ChannelParamsOf,
	type ExtractChannelParams,
} from "#questpie/server/channels/channel-builder.js";
import type { Channels } from "#questpie/server/channels/service.js";

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
const contextChannel = channel("wire-context").events({
	message: z.object({ text: z.string() }),
});
const thenChannel = channel("wire-then");
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
	context: typeof contextChannel;
	news: typeof publicNews;
	room: typeof privateRoom;
	then: typeof thenChannel;
};
declare const channels: Channels<AppChannels>;

channels.news.publish("updated", { id: "1", count: 1 });
channels.context.publish("message", { text: "registry first" });
// @ts-expect-error the facade must never become a Promise-like thenable
channels.then;
const room = channels.room({ roomId: "one" });
room.publish("message", { text: "hello" });
const boundPresence = room.resolvePresence();
type _boundPresence = Expect<
	Equal<Awaited<typeof boundPresence>, { id: string; roomId: string }>
>;
room.invalidateAuthority({
	subject: { kind: "user", id: "user-1" },
	idempotencyKey: "room-one:user-1:v1",
});

// @ts-expect-error parametric channel requires its complete params
channels.room();
// @ts-expect-error unknown param
channels.room({ room: "one" });
// @ts-expect-error wrong bound event payload
room.publish("message", { text: 123 });
// @ts-expect-error unknown bound event
room.publish("typing", { text: "hello" });

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
