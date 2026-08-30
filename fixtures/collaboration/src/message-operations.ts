import { defineCollectionOperations, operation } from "questpie";

import { channels } from "./channels";
import { channelPolicy, messagePolicy, spacePolicy } from "./message-policy";
import { messages } from "./messages";
import { spaces } from "./spaces";

const invalidMessageEvent = operation.error({
	code: "INVALID_MESSAGE_EVENT",
	status: 422,
});

const channelUnavailable = operation.error({
	code: "CHANNEL_UNAVAILABLE",
	status: 404,
});

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
		issueMappings: {
			messages: { channelUnavailable: "channelUnavailable" },
			messageEvents: { invalidKind: "invalidMessageEvent" },
		},
		errors: { channelUnavailable, invalidMessageEvent },
		select: { id: true, channelId: true, body: true, createdAt: true },
	},
});
