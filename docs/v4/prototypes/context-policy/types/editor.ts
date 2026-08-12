import { definePolicy, policy } from "questpie";

import { channels, messages } from "./collections";

export const editorPolicy = definePolicy(messages, {
	name: "messages.editorProbe",
	read: {
		admit: policy.authenticated(),
		rows: ({ row: message, principal, tenant }) => {
			const messageCompletion = message./*MESSAGE_COMPLETION*/ channelId;
			const messageHover = message.channelId /*MESSAGE_HOVER*/;
			const principalCompletion = principal./*PRINCIPAL_COMPLETION*/ id;
			const tenantHover = tenant.id /*TENANT_HOVER*/;
			void messageHover;
			void principalCompletion;
			void tenantHover;
			return policy.exists(channels, ({ row: channel }) => {
				const channelCompletion = channel./*CHANNEL_COMPLETION*/ spaceId;
				const channelHover = channel.spaceId /*CHANNEL_HOVER*/;
				void channelCompletion;
				void channelHover;
				return channel.id.equal(messageCompletion);
			});
		},
	},
	fields: {
		output: ({ row, principal }) => {
			const fieldsCompletion: Partial<typeof row> = {
				/*FIELDS_COMPLETION*/ moderationNote: row.authorId,
			};
			void fieldsCompletion;
			return { moderationNote: row.authorId.equal(principal.id) };
		},
	},
});
