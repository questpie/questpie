import { collection } from "#questpie/factories";
import { index } from "drizzle-orm/pg-core";

export const chatMessages = collection("chat_messages")
	.fields(({ f }) => ({
		chatSession: f
			.relation("chat_sessions")
			.required()
			.label({ en: "Chat Session" }),
		role: f
			.select([
				{ value: "user", label: { en: "User" } },
				{ value: "assistant", label: { en: "Assistant" } },
				{ value: "system", label: { en: "System" } },
				{ value: "tool", label: { en: "Tool" } },
			])
			.required()
			.label({ en: "Role" }),
		content: f.textarea().label({ en: "Content" }),
		run: f.relation("runs").label({ en: "Run" }),
		runStatus: f.text().label({ en: "Run Status" }),
		model: f.relation("models").label({ en: "Model" }),
		provider: f.relation("providers").label({ en: "Provider" }),
		metadata: f.json().label({ en: "Metadata" }),
	}))
	.admin(({ c }) => ({
		label: { en: "Chat Messages" },
		icon: c.icon("ph:chat-text"),
	}))
	.list(({ v }) => v.collectionTable({}))
	.indexes(({ table }) => [
		index("chat_messages_chat_session_idx").on(table.chatSession as any),
	]);
