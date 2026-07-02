/**
 * useAutopilotChat — client hook for the consolidated run model (T9).
 *
 * A turn = POST /api/chat mints a run_links row a fleet worker claims, runs,
 * and streams into resumable-KV; the FE consumes it through `@ai-sdk/react`'s
 * `useChat` with the custom {@link AutopilotChatTransport} (two channels, two
 * lifetimes: UIMessage chunks over the KV tail, run lifecycle over run_links
 * realtime).
 *
 * Message identity (§4.5): the optimistic user echo keeps the client-minted
 * UIMessage id; the server stores it as chat_messages.uiMessageId, so DB
 * hydration and the live state reconcile to the same ids. The assistant id is
 * the worker-minted `start.messageId`, persisted the same way by finalizeRun.
 *
 * Chat instances are cached per chatKey and survive session switches — a
 * stream keeps flowing in a background Chat and re-attaches instantly when
 * the user switches back. A "draft" chat (no server session yet) becomes a
 * persisted one on first send WITHOUT recreating the Chat (the transport
 * re-points via getSessionId, so the in-flight stream is untouched).
 */

import { Chat, useChat } from "@ai-sdk/react";
import { useMutation, useQuery, type QueryClient } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import * as React from "react";

import type { ChatAttachment } from "../lib/chat-attachments";
import {
	AutopilotChatTransport,
	type AutopilotTurn,
} from "../lib/autopilot-chat-transport";

type Doc = Record<string, any>;

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

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

function relationId(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (
		value &&
		typeof value === "object" &&
		typeof (value as any).id === "string"
	) {
		return (value as any).id;
	}
	return null;
}

function newChatKey(): string {
	if (typeof crypto !== "undefined" && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	return `draft-${Math.random().toString(36).slice(2)}`;
}

/** The last-open session survives reloads — a mid-stream reload must land
 * back on the streaming session to reattach (acceptance b). */
const LAST_SESSION_STORAGE_KEY = "autopilot-chat:last-session";

function readLastSessionId(): string | null {
	try {
		return window.localStorage.getItem(LAST_SESSION_STORAGE_KEY);
	} catch {
		return null;
	}
}

function writeLastSessionId(id: string | null) {
	try {
		if (id) window.localStorage.setItem(LAST_SESSION_STORAGE_KEY, id);
		else window.localStorage.removeItem(LAST_SESSION_STORAGE_KEY);
	} catch {
		// storage unavailable — reload restore is best-effort
	}
}

/** Metadata carried on hook-managed UIMessages (render + reconcile inputs). */
export interface AutopilotMessageMetadata {
	attachments?: ChatAttachment[];
	runStatus?: string | null;
	runId?: string | null;
	dbId?: string | null;
	createdAt?: string | null;
	[key: string]: unknown;
}

export type AutopilotUIMessage = UIMessage & {
	metadata?: AutopilotMessageMetadata;
};

/** Live status of the active turn's run_links row (§4.3 chip). */
export interface AutopilotRunInfo {
	id: string;
	status: string;
	worker: string | null;
	tokensInput: number | null;
	tokensOutput: number | null;
	error: string | null;
	createdAt: string | null;
}

export interface UseAutopilotChatOptions {
	client: unknown;
	queryClient: QueryClient;
	activeRoute?: string;
}

export interface AutopilotChatState {
	sessions: Doc[];
	sessionsLoading: boolean;
	activeSessionId: string | null;
	setActiveSessionId: (id: string | null) => void;
	messages: AutopilotUIMessage[];
	/** useChat status: submitted | streaming | ready | error */
	status: string;
	error: Error | undefined;
	/** The active turn's run row (live chip), null when idle. */
	runInfo: AutopilotRunInfo | null;
	/** True when the KV tail signalled a TTL gap — persisted parts are shown. */
	streamExpired: boolean;
	send: (content: string, attachments: ChatAttachment[]) => void;
	cancel: () => void;
	retry: () => void;
	clearError: () => void;
	invalidateSessions: () => void;
	invalidateMessages: () => void;
}

async function loadSessions(client: unknown) {
	const api = (client as any)?.collections?.chat_sessions;
	if (!api?.find) return [];
	try {
		return docsFromResult(
			await api.find({ limit: 40, orderBy: { updatedAt: "desc" } }),
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
	enabled = true,
) {
	React.useEffect(() => {
		if (!enabled) return;
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
	}, [client, collection, onChange, where, enabled]);
}

/** DB chat_messages row → UIMessage (persisted-parts hydration, §4.2). */
function rowToUIMessage(row: Doc): AutopilotUIMessage | null {
	const role = String(row.role ?? "");
	if (role !== "user" && role !== "assistant") return null;

	const id =
		typeof row.uiMessageId === "string" && row.uiMessageId
			? row.uiMessageId
			: String(row.id);

	// uiMessage is UIMessage[] (finalizeRun persists the turn's messages); be
	// tolerant of a single-object shape and fall back to plain content text.
	let parts: unknown[] | null = null;
	const stored = row.uiMessage;
	if (Array.isArray(stored) && stored.length > 0) {
		const last = stored[stored.length - 1];
		if (last && typeof last === "object" && Array.isArray((last as any).parts)) {
			parts = (last as any).parts as unknown[];
		}
	} else if (
		stored &&
		typeof stored === "object" &&
		Array.isArray((stored as any).parts)
	) {
		parts = (stored as any).parts as unknown[];
	}
	if (!parts) {
		const content = typeof row.content === "string" ? row.content : "";
		parts = content ? [{ type: "text", text: content }] : [];
	}

	const attachments = Array.isArray(row.metadata?.attachments)
		? (row.metadata.attachments as ChatAttachment[])
		: undefined;

	return {
		id,
		role: role as "user" | "assistant",
		parts: parts as AutopilotUIMessage["parts"],
		metadata: {
			attachments,
			runStatus: typeof row.runStatus === "string" ? row.runStatus : null,
			runId: relationId(row.run),
			dbId: String(row.id),
			createdAt:
				typeof row.createdAt === "string"
					? row.createdAt
					: (row.createdAt?.toISOString?.() ?? null),
		},
	};
}

/**
 * Merge DB-hydrated messages with local Chat state: the DB list is
 * authoritative for everything it contains; local-only messages (e.g. a
 * cancelled turn's partial assistant that was never persisted) are kept,
 * re-inserted after their nearest persisted predecessor.
 */
function mergeMessages(
	local: AutopilotUIMessage[],
	db: AutopilotUIMessage[],
): AutopilotUIMessage[] {
	if (local.length === 0) return db;
	const dbIds = new Set(db.map((message) => message.id));
	const merged = [...db];
	local.forEach((message, index) => {
		if (dbIds.has(message.id)) return;
		let insertAt = merged.length;
		for (let cursor = index - 1; cursor >= 0; cursor--) {
			const predecessor = local[cursor];
			const at = merged.findIndex((m) => m.id === predecessor.id);
			if (at !== -1) {
				insertAt = at + 1;
				break;
			}
		}
		merged.splice(insertAt, 0, message);
		dbIds.add(message.id);
	});
	return merged;
}

function sameIdSequence(
	a: AutopilotUIMessage[],
	b: AutopilotUIMessage[],
): boolean {
	if (a.length !== b.length) return false;
	for (let index = 0; index < a.length; index++) {
		if (a[index].id !== b[index].id) return false;
	}
	return true;
}

export function useAutopilotChat(
	options: UseAutopilotChatOptions,
): AutopilotChatState {
	const { client, queryClient, activeRoute } = options;

	// ── Chat identity ─────────────────────────────────────────
	// chatKey = Chat-instance identity (stable across draft → persisted);
	// sessionId = the server chat_sessions row the queries/realtime follow.
	const [active, setActive] = React.useState<{
		key: string;
		sessionId: string | null;
	}>(() => {
		const restored =
			typeof window !== "undefined" ? readLastSessionId() : null;
		return restored
			? { key: restored, sessionId: restored }
			: { key: newChatKey(), sessionId: null };
	});

	const chatsRef = React.useRef(new Map<string, Chat<AutopilotUIMessage>>());
	const sessionIdByKeyRef = React.useRef(new Map<string, string | null>());
	const keyBySessionIdRef = React.useRef(new Map<string, string>());
	// The localStorage-restored session must be visible to the transport's
	// getSessionId BEFORE the first send — idempotent render-time backfill.
	if (active.sessionId && !sessionIdByKeyRef.current.has(active.key)) {
		sessionIdByKeyRef.current.set(active.key, active.sessionId);
		keyBySessionIdRef.current.set(active.sessionId, active.key);
	}
	// Live turn (chip input) per chatKey, set by the transport's onTurnCreated.
	const [turns, setTurns] = React.useState<
		Record<string, { runId: string; messageDbId: string }>
	>({});
	const [expiredKeys, setExpiredKeys] = React.useState<Record<string, boolean>>(
		{},
	);
	// Bumped after every seed/reconcile so the resume effect re-evaluates.
	const [seedGeneration, setSeedGeneration] = React.useState(0);
	const resumeAttemptedRef = React.useRef(new Set<string>());
	// One automatic offset-resume per turn after a dropped connection.
	const disconnectRetriedRef = React.useRef(new Set<string>());

	const activeRouteRef = React.useRef(activeRoute);
	activeRouteRef.current = activeRoute;

	const basePath = React.useMemo(
		() => (client as any)?.getBasePath?.() ?? "/api",
		[client],
	);

	const invalidateSessions = React.useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: ["autopilot", "chat", "sessions"],
		});
	}, [queryClient]);

	const invalidateMessages = React.useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: ["autopilot", "chat", "messages"],
		});
	}, [queryClient]);

	const invalidateRun = React.useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: ["autopilot", "chat", "run"],
		});
	}, [queryClient]);

	const handleTurnCreated = React.useCallback(
		(key: string, turn: AutopilotTurn) => {
			const sessionId = relationId(turn.session) ?? turn.session?.id;
			if (typeof sessionId === "string" && sessionId) {
				sessionIdByKeyRef.current.set(key, sessionId);
				keyBySessionIdRef.current.set(sessionId, key);
				writeLastSessionId(sessionId);
				setActive((current) =>
					current.key === key && current.sessionId !== sessionId
						? { key, sessionId }
						: current,
				);
			}
			const messageDbId = turn.message?.id ? String(turn.message.id) : null;
			if (turn.runId && messageDbId) {
				setTurns((current) => ({
					...current,
					[key]: { runId: String(turn.runId), messageDbId },
				}));
			}
			disconnectRetriedRef.current.delete(key);
			setExpiredKeys((current) =>
				current[key] ? { ...current, [key]: false } : current,
			);
			invalidateSessions();
			invalidateRun();
		},
		[invalidateSessions, invalidateRun],
	);

	const handleStreamExpired = React.useCallback((key: string) => {
		setExpiredKeys((current) => ({ ...current, [key]: true }));
	}, []);

	const getOrCreateChat = React.useCallback(
		(key: string): Chat<AutopilotUIMessage> => {
			let chat = chatsRef.current.get(key);
			if (chat) return chat;

			const transport = new AutopilotChatTransport({
				basePath,
				getSessionId: () => sessionIdByKeyRef.current.get(key) ?? null,
				getSendContext: () => ({
					activeRoute: activeRouteRef.current ?? null,
				}),
				onTurnCreated: (turn) => handleTurnCreated(key, turn),
				onStreamExpired: () => handleStreamExpired(key),
			});
			chat = new Chat<AutopilotUIMessage>({
				id: key,
				transport,
				onFinish: ({ isDisconnect }) => {
					invalidateMessages();
					invalidateSessions();
					invalidateRun();
					// A dropped connection mid-turn auto-resumes ONCE at the true
					// offset (transport sends Last-Event-ID) — the run keeps
					// executing server-side regardless.
					if (isDisconnect && !disconnectRetriedRef.current.has(key)) {
						disconnectRetriedRef.current.add(key);
						const liveChat = chatsRef.current.get(key);
						setTimeout(() => {
							liveChat?.clearError();
							void liveChat?.resumeStream().catch(() => {});
						}, 800);
					}
				},
			});
			chatsRef.current.set(key, chat);
			return chat;
		},
		[
			basePath,
			handleTurnCreated,
			handleStreamExpired,
			invalidateMessages,
			invalidateSessions,
			invalidateRun,
		],
	);

	const activeChat = getOrCreateChat(active.key);
	const chatHelpers = useChat<AutopilotUIMessage>({
		chat: activeChat,
		experimental_throttle: 50,
	});

	// ── Queries + realtime ────────────────────────────────────
	const sessionsQuery = useQuery({
		queryKey: ["autopilot", "chat", "sessions"],
		queryFn: () => loadSessions(client),
		enabled: !!client,
		staleTime: 20_000,
	});

	const messagesQuery = useQuery({
		queryKey: ["autopilot", "chat", "messages", active.sessionId],
		queryFn: () => loadMessages(client, active.sessionId),
		enabled: !!client && !!active.sessionId,
	});

	const selectedMessagesWhere = React.useMemo(
		() => (active.sessionId ? { chatSession: active.sessionId } : undefined),
		[active.sessionId],
	);

	useCollectionRealtime(client, "chat_sessions", invalidateSessions);
	useCollectionRealtime(
		client,
		"chat_messages",
		invalidateMessages,
		selectedMessagesWhere,
		!!active.sessionId,
	);

	const sessions = React.useMemo(
		() => sessionsQuery.data ?? [],
		[sessionsQuery.data],
	);

	// ── Seed / reconcile Chat state from DB rows ──────────────
	const dbRows = messagesQuery.data;
	const chatStatus = chatHelpers.status;
	React.useEffect(() => {
		if (!dbRows || !active.sessionId) return;
		if (chatStatus === "streaming" || chatStatus === "submitted") return;
		const chat = chatsRef.current.get(active.key);
		if (!chat) return;

		const mapped = dbRows
			.map(rowToUIMessage)
			.filter((message): message is AutopilotUIMessage => message !== null);
		const merged = mergeMessages(chat.messages, mapped);
		if (!sameIdSequence(chat.messages, merged)) {
			chat.messages = merged;
			// A user-tail appearing while ready (another tab's turn) should allow a
			// fresh live-attach for this session.
			const last = merged[merged.length - 1];
			if (last?.role === "user") {
				resumeAttemptedRef.current.delete(`${active.key}:${active.sessionId}`);
			}
		}
		setSeedGeneration((generation) => generation + 1);
	}, [dbRows, active.key, active.sessionId, chatStatus]);

	// ── Resume (manual — §0.2/0.3 of the T9 spec) ─────────────
	// Only after history has seeded, and only when the last message is a user
	// turn (an assistant-last history means the turn finished; replaying the
	// KV stream over it would duplicate parts).
	React.useEffect(() => {
		if (!active.sessionId || !messagesQuery.isSuccess) return;
		const chat = chatsRef.current.get(active.key);
		if (!chat) return;
		if (chat.status === "streaming" || chat.status === "submitted") return;

		const resumeKey = `${active.key}:${active.sessionId}`;
		if (resumeAttemptedRef.current.has(resumeKey)) return;
		resumeAttemptedRef.current.add(resumeKey);

		const last = chat.messages[chat.messages.length - 1];
		let shouldResume = false;
		if (last) {
			shouldResume = last.role === "user";
		} else {
			const session = sessions.find((doc) => doc.id === active.sessionId);
			const activeRunId = relationId(session?.activeRun);
			shouldResume = !!activeRunId;
		}
		if (shouldResume) {
			void chat.resumeStream().catch(() => {});
		}
	}, [
		active.key,
		active.sessionId,
		messagesQuery.isSuccess,
		seedGeneration,
		sessions,
	]);

	// ── Active-turn run chip (§4.3) ───────────────────────────
	// Prefer the transport-reported turn; fall back to the hydrated last user
	// message when re-opening a session with an in-flight run. Everything is
	// derived down to PRIMITIVE strings before building where objects — object
	// identities churning per render caused a realtime resubscribe storm.
	const activeTurn = turns[active.key] ?? null;
	const sessionActiveRunId = React.useMemo(() => {
		if (!active.sessionId) return null;
		const session = sessions.find((doc) => doc.id === active.sessionId);
		return relationId(session?.activeRun);
	}, [sessions, active.sessionId]);
	const lastUserDbId = React.useMemo(() => {
		for (let index = chatHelpers.messages.length - 1; index >= 0; index--) {
			const message = chatHelpers.messages[index];
			if (message.role === "user") return message.metadata?.dbId ?? null;
		}
		return null;
	}, [chatHelpers.messages]);
	const chipRunId = activeTurn?.runId ?? null;
	const chipMessageDbId =
		activeTurn?.messageDbId ?? (sessionActiveRunId ? lastUserDbId : null);

	const runQuery = useQuery({
		queryKey: ["autopilot", "chat", "run", chipRunId ?? chipMessageDbId ?? "none"],
		enabled: !!client && !!(chipRunId || chipMessageDbId),
		refetchInterval: 20_000,
		queryFn: async (): Promise<AutopilotRunInfo | null> => {
			const api = (client as any)?.collections?.run_links;
			if (!api?.find || !(chipRunId || chipMessageDbId)) return null;
			const docs = docsFromResult(
				await api.find({
					where: chipRunId
						? { id: chipRunId }
						: { chatMessage: chipMessageDbId },
					orderBy: { createdAt: "desc" },
					limit: 1,
				}),
			);
			const run = docs[0];
			if (!run) return null;
			return {
				id: String(run.id),
				status: String(run.status ?? "pending"),
				worker: relationId(run.worker),
				tokensInput:
					typeof run.tokensInput === "number" ? run.tokensInput : null,
				tokensOutput:
					typeof run.tokensOutput === "number" ? run.tokensOutput : null,
				error: typeof run.error === "string" ? run.error : null,
				createdAt:
					typeof run.createdAt === "string"
						? run.createdAt
						: (run.createdAt?.toISOString?.() ?? null),
			};
		},
	});

	const chipWhere = React.useMemo(
		() => (chipMessageDbId ? { chatMessage: chipMessageDbId } : undefined),
		[chipMessageDbId],
	);
	useCollectionRealtime(
		client,
		"run_links",
		invalidateRun,
		chipWhere,
		!!chipWhere,
	);

	const runInfo = runQuery.data ?? null;
	const runTerminal = runInfo ? TERMINAL_RUN_STATUSES.has(runInfo.status) : false;

	// Drop the turn record once its run is terminal and the chat is idle — the
	// chip disappears, historical badges render from persisted rows instead.
	React.useEffect(() => {
		if (!runTerminal) return;
		if (chatStatus === "streaming" || chatStatus === "submitted") return;
		const turn = turns[active.key];
		if (!turn) return;
		const timeout = setTimeout(() => {
			setTurns((current) => {
				if (!current[active.key]) return current;
				const next = { ...current };
				delete next[active.key];
				return next;
			});
		}, 4_000);
		return () => clearTimeout(timeout);
	}, [runTerminal, chatStatus, turns, active.key]);

	// ── Actions ───────────────────────────────────────────────
	const send = React.useCallback(
		(content: string, attachments: ChatAttachment[]) => {
			const chat = getOrCreateChat(active.key);
			setExpiredKeys((current) =>
				current[active.key] ? { ...current, [active.key]: false } : current,
			);
			void chat
				.sendMessage({
					text: content,
					metadata: attachments.length ? { attachments } : undefined,
				})
				.catch(() => {
					// surfaced via chat.error
				});
		},
		[active.key, getOrCreateChat],
	);

	const cancelMutation = useMutation({
		mutationFn: async (sessionId: string) => {
			const response = await fetch(
				`${basePath}/chat/${encodeURIComponent(sessionId)}/cancel`,
				{ method: "POST", headers: { "x-questpie-admin": "1" } },
			);
			if (!response.ok) throw new Error(`Cancel failed (${response.status})`);
			return response.json();
		},
		onSettled: () => {
			invalidateRun();
			invalidateMessages();
		},
	});

	const cancel = React.useCallback(() => {
		const chat = chatsRef.current.get(active.key);
		void chat?.stop();
		if (active.sessionId) cancelMutation.mutate(active.sessionId);
	}, [active.key, active.sessionId, cancelMutation]);

	const retry = React.useCallback(() => {
		const chat = chatsRef.current.get(active.key);
		// regenerate() throws on an empty message list — nothing to retry then.
		if (!chat || chat.messages.length === 0) return;
		chat.clearError();
		setExpiredKeys((current) =>
			current[active.key] ? { ...current, [active.key]: false } : current,
		);
		void chat.regenerate().catch(() => {
			// surfaced via chat.error
		});
	}, [active.key]);

	const clearError = React.useCallback(() => {
		chatsRef.current.get(active.key)?.clearError();
	}, [active.key]);

	const setActiveSessionId = React.useCallback((id: string | null) => {
		writeLastSessionId(id);
		if (id === null) {
			setActive({ key: newChatKey(), sessionId: null });
			return;
		}
		const key = keyBySessionIdRef.current.get(id) ?? id;
		sessionIdByKeyRef.current.set(key, id);
		keyBySessionIdRef.current.set(id, key);
		setActive({ key, sessionId: id });
	}, []);

	return {
		sessions,
		sessionsLoading: sessionsQuery.isLoading,
		activeSessionId: active.sessionId,
		setActiveSessionId,
		messages: chatHelpers.messages,
		status: chatHelpers.status,
		error: chatHelpers.error,
		runInfo,
		streamExpired: !!expiredKeys[active.key],
		send,
		cancel,
		retry,
		clearError,
		invalidateSessions,
		invalidateMessages,
	};
}
