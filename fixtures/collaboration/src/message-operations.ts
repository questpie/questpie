import { defineCollectionOperations, mutation, operation } from "questpie";

import { channels } from "./channels";
import { messageEvents } from "./message-events";
import {
	channelPolicy,
	messageEventPolicy,
	messagePolicy,
	spacePolicy,
} from "./message-policy";
import { messages } from "./messages";
import { spaces } from "./spaces";

export const channelOperations = defineCollectionOperations(channels, {
	name: "channels",
	policy: channelPolicy,
	get: { select: { id: true, spaceId: true } },
});

export const spaceOperations = defineCollectionOperations(spaces, {
	name: "spaces",
	policy: spacePolicy,
	get: { select: { id: true, companyId: true } },
});

export const messageOperations = defineCollectionOperations(messages, {
	name: "messages",
	policy: messagePolicy,
	create: {
		input: ["channelId", "authorMembershipId", "body"],
		normalize: ({ input }) => ({ body: operation.text.trim(input.body) }),
		values: ({ operationTime }) => ({
			createdAt: mutation.overwrite(operationTime),
		}),
		select: { id: true, channelId: true, body: true, createdAt: true },
	},
});

export const messageEventOperations = defineCollectionOperations(
	messageEvents,
	{
		name: "messageEvents",
		policy: messageEventPolicy,
		create: {
			input: ["messageId", "kind"],
			values: ({ operationTime }) => ({
				occurredAt: mutation.overwrite(operationTime),
			}),
			select: { id: true },
		},
	},
);
