import { z } from "zod";

import type { ChannelMessage, QuestpieClient } from "#questpie/client/index.js";
import { channel } from "#questpie/server/channels/channel-builder.js";

import type { Equal, Expect } from "./type-test-utils.js";

const news = channel("news").events({
	metric: z.object({ value: z.string().transform(Number) }),
});
const publish = channel("wire-publish").events({
	message: z.object({ text: z.string() }),
});
const thenChannel = channel("wire-then");
const room = channel("room-[roomId]")
	.events({
		message: z.object({ text: z.string() }),
		typing: z.object({ active: z.boolean() }),
	})
	.authorize({ subscribe: true })
	.presence(({ params }) => ({ id: "user-1", roomId: params.roomId }));

type App = {
	collections: {};
	channels: {
		news: typeof news;
		publish: typeof publish;
		room: typeof room;
		then: typeof thenChannel;
	};
	globals: {};
	routes: {};
};

declare const client: QuestpieClient<App>;

// App-agnostic consumers can accept a concrete client without widening the
// channel map into an index signature that conflicts with lifecycle methods.
const appAgnosticClient: QuestpieClient<any> = client;
appAgnosticClient.channels.destroy();

client.channels.news.subscribe((message) => {
	if (message.event === "metric") {
		type _outputWasInferred = Expect<Equal<typeof message.data.value, number>>;
	}
});
client.channels.room.subscribe({ roomId: "one" }, (message) => {
	if (message.event === "message") {
		type _messagePayload = Expect<Equal<typeof message.data, { text: string }>>;
	} else {
		type _typingPayload = Expect<
			Equal<typeof message.data, { active: boolean }>
		>;
	}
});

client.channels.news.publish({
	event: "metric",
	data: { value: "42" },
});
client.channels.room.publish({
	params: { roomId: "one" },
	event: "message",
	data: { text: "hello" },
});

client.channels.news.publish("metric", { value: "42" });
client.channels.publish.publish({
	event: "message",
	data: { text: "legacy client channel name" },
});
// @ts-expect-error the facade must never become a Promise-like thenable
client.channels.then;
const boundRoom = client.channels.room({ roomId: "one" });
boundRoom.publish("message", { text: "hello" });
boundRoom.subscribe((message) => {
	type _boundMessage = Expect<
		Equal<typeof message, ChannelMessage<typeof room>>
	>;
});
boundRoom.presence();

// @ts-expect-error bound params are required
client.channels.room();
// @ts-expect-error wrong bound param key
client.channels.room({ id: "one" });
// @ts-expect-error bound payload remains schema-typed
boundRoom.publish("typing", { active: "yes" });

const roomMessages = client.channels.room.iter({ roomId: "one" });
type _iterMessage = Expect<
	Equal<
		Awaited<ReturnType<typeof roomMessages.next>>["value"],
		ChannelMessage<typeof room> | void
	>
>;
const presence = client.channels.room.presence({ roomId: "one" });
type _presence = Expect<
	Equal<Awaited<typeof presence>, readonly { id: string; roomId: string }[]>
>;
client.channels.room.subscribePresence({ roomId: "one" }, (members) => {
	type _presenceMember = Expect<
		Equal<(typeof members)[number], { id: string; roomId: string }>
	>;
});
const presenceSnapshots = client.channels.room.presenceIter({ roomId: "one" });
type _presenceSnapshot = Expect<
	Equal<
		Awaited<ReturnType<typeof presenceSnapshots.next>>["value"],
		readonly { id: string; roomId: string }[] | void
	>
>;

// @ts-expect-error parameterized subscriptions require their pattern params
client.channels.room.subscribe(() => {});
// @ts-expect-error public no-param channels do not accept params
client.channels.news.subscribe({}, () => {});
// @ts-expect-error parameterized publish requires params
client.channels.room.publish({ event: "message", data: { text: "hello" } });
client.channels.room.publish({
	// @ts-expect-error wrong param key
	params: { id: "one" },
	event: "message",
	data: { text: "hello" },
});
client.channels.room.publish({
	params: { roomId: "one" },
	event: "typing",
	// @ts-expect-error event payload is schema-typed
	data: { active: "yes" },
});
// @ts-expect-error only presence channels expose presence()
client.channels.news.presence();
// @ts-expect-error only presence channels expose subscribePresence()
client.channels.news.subscribePresence(() => {});
// @ts-expect-error only presence channels expose presenceIter()
client.channels.news.presenceIter();
