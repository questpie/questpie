/**
 * useAutopilotChat — client hook for chat v7 (background producer architecture).
 *
 * Manages chat sessions + messages via the QUESTPIE collection client,
 * sends new turns via `routes.chat(...)`, and streams the assistant response
 * via the resumable SSE endpoint `/api/chat/{chatId}/stream`.
 */

import { useMutation, useQuery, type QueryClient } from "@tanstack/react-query";
import * as React from "react";

import type { ChatAttachment } from "../lib/chat-attachments";

type Doc = Record<string, any>;

function docsFromResult(result: unknown): Doc[] {
	if (Array.isArray(result)) return result as Doc[];
	if (
		result &&
		typeof result === "object" &&
		Array.isArray((result as any).docs)
	) {
		return (result as any).docs as Doc[];
	}
	return [];
}

export interface UseAutopilotChatOptions {
	client: unknown;
	queryClient: QueryClient;
	activeRoute?: string;
}

export interface AutopilotChatState {
	sessions: Doc[];
	messages: Doc[];
	activeSessionId: string | null;
	streamingText: string;
	isStreaming: boolean;
	streamError: string | null;
	isSending: boolean;
	sendError: string | null;
	setActiveSessionId: (id: string | null) => void;
	send: (content: string, attachments: ChatAttachment[]) => void;
	cancel: () => void;
	invalidateSessions: () => void;
	invalidateMessages: () => void;
	sessionsLoading: boolean;
}

async function loadSessions(client: unknown) {
	const api = (client as any)?.collections?.chat_sessions;
	if (!api?.find) return [];
	try {
		return docsFromResult(
			await api.find({
				limit: 40,
				orderBy: { updatedAt: "desc" },
			}),
		);
	} catch {
		return docsFromResult(await api.find({ limit: 40 }));
	}
}

async function loadMessages(client: unknown, sessionId: string | null) {
	if (!sessionId) return [];
	const api = (client as any)?.collections?.chat_messages;
	if (!api?.find) return [];
	return docsFromResult(
		await api.find({
			where: { chatSession: sessionId },
			limit: 200,
			orderBy: { createdAt: "asc" },
		}),
	);
}

function useCollectionRealtime(
	client: unknown,
	collection: string,
	onChange: () => void,
	where?: Record<string, unknown>,
) {
	React.useEffect(() => {
		const realtime = (client as any)?.realtime;
		if (!realtime?.subscribe) return;

		return realtime.subscribe(
			{
				resourceType: "collection",
				resource: collection,
				...(where ? { where } : {}),
			},
			onChange,
			undefined,
			`autopilot-chat:${collection}:${JSON.stringify(where ?? {})}`,
		);
	}, [client, collection, onChange, where]);
}

/**
 * Stream the resumable SSE from the chat session's activeStreamId.
 * Accumulates text deltas into `streamingText`.
 */
function useChatStream(
	client: unknown,
	chatId: string | null,
	activeStreamId: string | null,
) {
	const [streamingText, setStreamingText] = React.useState("");
	const [isStreaming, setIsStreaming] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	React.useEffect(() => {
		setStreamingText("");
		setError(null);

		if (!chatId || !activeStreamId || typeof window === "undefined") {
			setIsStreaming(false);
			return;
		}

		setIsStreaming(true);
		const apiBasePath = (client as any)?.getBasePath?.() ?? "/api";
		const url = `${apiBasePath}/chat/${encodeURIComponent(chatId)}/stream`;
		const source = new EventSource(url);
		let closed = false;

		source.onmessage = (event) => {
			if (closed) return;
			try {
				// The data is a UIMessage SSE chunk — parse text parts
				const chunk = event.data;
				if (typeof chunk === "string" && chunk.trim()) {
					// UIMessage stream format: each chunk is a JSON line
					try {
						const parsed = JSON.parse(chunk);
						if (parsed.type === "text-delta" && typeof parsed.textDelta === "string") {
							setStreamingText((prev) => prev + parsed.textDelta);
						}
					} catch {
						// Raw text chunk
						setStreamingText((prev) => prev + chunk);
					}
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			}
		};

		source.onerror = () => {
			if (source.readyState === EventSource.CLOSED) {
				setIsStreaming(false);
				closed = true;
			}
		};

		source.addEventListener("close", () => {
			setIsStreaming(false);
			closed = true;
			source.close();
		});

		return () => {
			closed = true;
			source.close();
			setIsStreaming(false);
		};
	}, [client, chatId, activeStreamId]);

	return { streamingText, isStreaming, error };
}

export function useAutopilotChat(
	options: UseAutopilotChatOptions,
): AutopilotChatState {
	const { client, queryClient, activeRoute } = options;
	const [activeSessionId, setActiveSessionId] = React.useState<string | null>(
		null,
	);
	const [activeStreamId, setActiveStreamId] = React.useState<string | null>(
		null,
	);

	const sessionsQuery = useQuery({
		queryKey: ["autopilot", "chat", "sessions"],
		queryFn: () => loadSessions(client),
		enabled: !!client,
		staleTime: 20_000,
	});

	const messagesQuery = useQuery({
		queryKey: ["autopilot", "chat", "messages", activeSessionId],
		queryFn: () => loadMessages(client, activeSessionId),
		enabled: !!client && !!activeSessionId,
	});

	const invalidateSessions = React.useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: ["autopilot", "chat", "sessions"],
		});
	}, [queryClient]);

	const invalidateMessages = React.useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: ["autopilot", "chat", "messages", activeSessionId],
		});
	}, [queryClient, activeSessionId]);

	const selectedMessagesWhere = React.useMemo(
		() => (activeSessionId ? { chatSession: activeSessionId } : undefined),
		[activeSessionId],
	);

	useCollectionRealtime(client, "chat_sessions", invalidateSessions);
	useCollectionRealtime(
		client,
		"chat_messages",
		() => {
			invalidateMessages();
			// When messages update, check if streaming is done
			if (activeSessionId && activeStreamId) {
				void loadSessions(client).then((sessions) => {
					const session = sessions.find((s) => s.id === activeSessionId);
					if (session && !session.activeStreamId) {
						setActiveStreamId(null);
					}
				});
			}
		},
		selectedMessagesWhere,
	);

	const sessions = React.useMemo(
		() => sessionsQuery.data ?? [],
		[sessionsQuery.data],
	);
	const messages = React.useMemo(
		() => messagesQuery.data ?? [],
		[messagesQuery.data],
	);

	// Stream the active chat
	const { streamingText, isStreaming, error: streamError } = useChatStream(
		client,
		activeSessionId,
		activeStreamId,
	);

	// ── Send mutation ─────────────────────────────────────────
	const sendMutation = useMutation({
		mutationFn: async ({
			content,
			attachments,
		}: {
			content: string;
			attachments: ChatAttachment[];
		}) => {
			return (client as any).routes.chat({
				chatSessionId: activeSessionId ?? undefined,
				content,
				attachments,
				metadata: {
					source: "admin-rail",
					activeRoute: activeRoute ?? null,
				},
			});
		},
		onSuccess: (result: Doc) => {
			const sessionId = result.session?.id ?? result.message?.chatSession;
			if (sessionId) {
				setActiveSessionId(String(sessionId));
			}
			if (result.streamId) {
				setActiveStreamId(String(result.streamId));
			}
			invalidateSessions();
			invalidateMessages();
		},
	});

	const send = React.useCallback(
		(content: string, attachments: ChatAttachment[]) => {
			sendMutation.mutate({ content, attachments });
		},
		[sendMutation],
	);

	const cancel = React.useCallback(() => {
		if (!activeSessionId) return;
		const apiBasePath = (client as any)?.getBasePath?.() ?? "/api";
		void fetch(
			`${apiBasePath}/chat/${encodeURIComponent(activeSessionId)}/cancel`,
			{ method: "POST" },
		).then(() => {
			setActiveStreamId(null);
			invalidateMessages();
		});
	}, [client, activeSessionId, invalidateMessages]);

	return {
		sessions,
		messages,
		activeSessionId,
		streamingText,
		isStreaming,
		streamError,
		isSending: sendMutation.isPending,
		sendError: sendMutation.error
			? sendMutation.error instanceof Error
				? sendMutation.error.message
				: "Send failed"
			: null,
		setActiveSessionId: (id) => {
			setActiveSessionId(id);
			setActiveStreamId(null);
		},
		send,
		cancel,
		invalidateSessions,
		invalidateMessages,
		sessionsLoading: sessionsQuery.isLoading,
	};
}
