export type ChatAttachment = {
	type: string;
	source?: string;
	label?: string;
	name?: string;
	refType?: string;
	refId?: string;
	content?: string;
	mimeType?: string;
	size?: number;
	url?: string;
	metadata?: Record<string, unknown>;
};

export const CHAT_ATTACHMENT_DRAG_MIME =
	"application/x-questpie-chat-attachment";

export const CHAT_ATTACHMENT_EVENT = "questpie:autopilot-attach";

export function chatAttachmentKey(attachment: ChatAttachment) {
	return JSON.stringify([
		attachment.type,
		attachment.source,
		attachment.label,
		attachment.name,
		attachment.refType,
		attachment.refId,
		attachment.url,
	]);
}

export function chatAttachmentLabel(attachment: ChatAttachment, index: number) {
	return (
		attachment.label ??
		attachment.name ??
		attachment.url ??
		attachment.refId ??
		`attachment-${index + 1}`
	);
}

export function setChatAttachmentDragData(
	dataTransfer: DataTransfer,
	attachment: ChatAttachment,
) {
	dataTransfer.effectAllowed = "copy";
	dataTransfer.setData(CHAT_ATTACHMENT_DRAG_MIME, JSON.stringify(attachment));
}

export function dispatchChatAttachment(attachment: ChatAttachment) {
	if (typeof window === "undefined") return false;
	window.dispatchEvent(
		new CustomEvent<ChatAttachment>(CHAT_ATTACHMENT_EVENT, {
			detail: attachment,
		}),
	);
	return true;
}
