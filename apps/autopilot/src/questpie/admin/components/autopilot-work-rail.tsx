import { Icon } from "@iconify/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import {
	AdminLink,
	selectBasePath,
	selectClient,
	useAdminStore,
	type AdminShellRailProps,
} from "@questpie/admin/client";

type Doc = Record<string, any>;

type ChatAttachment = {
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

type RunStreamEvent =
	| { type: "run"; run: Doc }
	| { type: "run_event"; event: Doc }
	| { type: "stream_error"; error: string }
	| { type: "heartbeat"; ts: string };

const CHAT_ATTACHMENT_DRAG_MIME = "application/x-questpie-chat-attachment";

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

function itemTitle(doc: Doc, fallback: string): string {
	const title = doc.title ?? doc.name ?? doc.id;
	return typeof title === "string" && title.trim() ? title : fallback;
}

function formatTime(value: unknown): string {
	if (!value) return "";
	const time = new Date(String(value)).getTime();
	if (!Number.isFinite(time)) return "";
	return new Intl.DateTimeFormat(undefined, {
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(time));
}

function statusTone(status: unknown): string {
	switch (status) {
		case "running":
			return "bg-info";
		case "completed":
		case "done":
		case "review":
			return "bg-success";
		case "failed":
		case "cancelled":
			return "bg-destructive";
		case "claimed":
		case "pending":
			return "bg-warning";
		default:
			return "bg-muted-foreground";
	}
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
			`autopilot-rail:${collection}:${JSON.stringify(where ?? {})}`,
		);
	}, [client, collection, onChange, where]);
}

function useRunStream(client: unknown, runId: string | null) {
	const [run, setRun] = React.useState<Doc | null>(null);
	const [events, setEvents] = React.useState<Doc[]>([]);
	const [error, setError] = React.useState<string | null>(null);

	React.useEffect(() => {
		setRun(null);
		setEvents([]);
		setError(null);
		if (!runId || typeof window === "undefined") return;

		const apiBasePath = (client as any)?.getBasePath?.() ?? "/api";
		const source = new EventSource(
			`${apiBasePath}/run-stream?runId=${encodeURIComponent(runId)}`,
		);

		const handle = (event: Event) => {
			try {
				const raw = event as MessageEvent<string>;
				const data = JSON.parse(raw.data) as RunStreamEvent;
				if (data.type === "run") setRun(data.run);
				if (data.type === "run_event") {
					setEvents((prev) => {
						if (prev.some((item) => item.id === data.event.id)) return prev;
						return [...prev, data.event].slice(-100);
					});
				}
				if (data.type === "stream_error") setError(data.error);
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			}
		};

		source.addEventListener("run", handle);
		source.addEventListener("run_event", handle);
		source.addEventListener("stream_error", handle);
		source.onerror = () => {
			if (source.readyState === EventSource.CLOSED) {
				setError("Run stream closed.");
			}
		};

		return () => source.close();
	}, [client, runId]);

	return { run, events, error };
}

function routeAttachment(activeRoute?: string): ChatAttachment | null {
	if (!activeRoute) return null;
	const match = activeRoute.match(/\/collections\/([^/]+)\/([^/?#]+)/);
	if (!match) return null;

	const [, collection, rawId] = match;
	if (!collection || !rawId || rawId === "create") return null;

	const refTypeByCollection: Record<string, string> = {
		chat_sessions: "session",
		knowledge: "knowledge",
		projects: "project",
		runs: "run",
		tasks: "task",
	};
	const refType = refTypeByCollection[collection] ?? collection;

	return {
		type: "ref",
		source: "page",
		label: `Current ${refType} ${rawId.slice(0, 8)}`,
		refType,
		refId: rawId,
		metadata: { activeRoute, collection },
	};
}

function attachmentKey(attachment: ChatAttachment) {
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

function attachmentLabel(attachment: ChatAttachment, index: number) {
	return (
		attachment.label ??
		attachment.name ??
		attachment.url ??
		attachment.refId ??
		`attachment-${index + 1}`
	);
}

function hasDropPayload(dataTransfer: DataTransfer) {
	return (
		Array.from(dataTransfer.types).includes(CHAT_ATTACHMENT_DRAG_MIME) ||
		Array.from(dataTransfer.types).includes("text/uri-list") ||
		Array.from(dataTransfer.types).includes("text/plain") ||
		dataTransfer.files.length > 0
	);
}

async function attachmentFromFile(file: File): Promise<ChatAttachment> {
	const isTextLike =
		file.type.startsWith("text/") ||
		/\.(md|txt|json|js|jsx|ts|tsx|css|html|py|rs|go|sh|sql|yaml|yml|csv)$/i.test(
			file.name,
		);

	if (isTextLike && file.size <= 200_000) {
		return {
			type: "text",
			source: "drop",
			name: file.name,
			mimeType: file.type || "text/plain",
			size: file.size,
			content: await file.text(),
		};
	}

	return {
		type: "file",
		source: "drop",
		name: file.name,
		mimeType: file.type || "application/octet-stream",
		size: file.size,
	};
}

async function attachmentsFromDrop(dataTransfer: DataTransfer) {
	const custom = dataTransfer.getData(CHAT_ATTACHMENT_DRAG_MIME);
	if (custom) {
		try {
			const parsed = JSON.parse(custom);
			if (parsed && typeof parsed === "object") {
				return [{ ...(parsed as ChatAttachment), source: "drag" }];
			}
		} catch {
			return [];
		}
	}

	const files = Array.from(dataTransfer.files ?? []);
	if (files.length > 0) {
		return Promise.all(files.map(attachmentFromFile));
	}

	const uri = dataTransfer.getData("text/uri-list");
	if (uri) {
		return [
			{
				type: "url",
				source: "drop",
				url: uri,
				label: uri,
			},
		];
	}

	const text = dataTransfer.getData("text/plain");
	if (text?.trim()) {
		return [
			{
				type: "text",
				source: "drop",
				name: "dropped-text.txt",
				content: text,
				size: text.length,
			},
		];
	}

	return [];
}

function AttachmentChip({
	attachment,
	index,
	onRemove,
}: {
	attachment: ChatAttachment;
	index: number;
	onRemove: () => void;
}) {
	const icon =
		attachment.type === "ref"
			? "ph:link-simple"
			: attachment.type === "url"
				? "ph:globe"
				: attachment.type === "text"
					? "ph:file-text"
					: "ph:paperclip";

	return (
		<button
			type="button"
			onClick={onRemove}
			className="border-border-subtle bg-muted/40 hover:bg-muted flex max-w-full items-center gap-1.5 border px-2 py-1 text-[11px]"
			title="Remove attachment"
		>
			<Icon icon={icon} className="size-3 shrink-0" />
			<span className="truncate">{attachmentLabel(attachment, index)}</span>
			<Icon icon="ph:x" className="size-3 shrink-0" />
		</button>
	);
}

function SessionRow({
	session,
	active,
	onSelect,
}: {
	session: Doc;
	active: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onSelect}
			className={[
				"item-surface mb-1 flex min-h-12 w-full items-start gap-2 px-2 py-2 text-left transition-colors",
				active
					? "border-transparent bg-[var(--sidebar-active-background)] text-[var(--sidebar-active-foreground)]"
					: "hover:bg-muted/70",
			].join(" ")}
			draggable
			onDragStart={(event) => {
				event.dataTransfer.effectAllowed = "copy";
				event.dataTransfer.setData(
					CHAT_ATTACHMENT_DRAG_MIME,
					JSON.stringify({
						type: "ref",
						source: "drag",
						label: itemTitle(session, "Untitled chat"),
						refType: "session",
						refId: session.id,
						metadata: { sessionId: session.id },
					}),
				);
			}}
		>
			<span
				className={[
					"mt-1.5 size-2 shrink-0 rounded-full",
					statusTone(session.status),
				].join(" ")}
			/>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-xs font-medium">
					{itemTitle(session, "Untitled chat")}
				</span>
				<span className="text-muted-foreground mt-0.5 block truncate text-[11px]">
					{session.scopeType ?? session.status ?? "company"}
				</span>
			</span>
			<span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
				{formatTime(session.updatedAt ?? session.createdAt)}
			</span>
		</button>
	);
}

function MessageBubble({ message }: { message: Doc }) {
	const role = String(message.role ?? "assistant");
	const isUser = role === "user";
	const attachments = Array.isArray(message.metadata?.attachments)
		? (message.metadata.attachments as ChatAttachment[])
		: [];

	return (
		<div
			className={["flex", isUser ? "justify-end" : "justify-start"].join(" ")}
		>
			<div
				className={[
					"max-w-[92%] border px-3 py-2 text-sm",
					isUser
						? "border-primary/30 bg-primary/10"
						: "border-border-subtle bg-card/70",
				].join(" ")}
			>
				<div className="text-muted-foreground mb-1 flex items-center gap-2 text-[10px] uppercase">
					<span>{role}</span>
					{message.runStatus ? <span>{message.runStatus}</span> : null}
				</div>
				{message.content ? (
					<div className="leading-relaxed break-words whitespace-pre-wrap">
						{message.content}
					</div>
				) : null}
				{attachments.length > 0 ? (
					<div className="mt-2 flex flex-wrap gap-1.5">
						{attachments.map((attachment, index) => (
							<span
								key={`${attachmentKey(attachment)}-${index}`}
								className="border-border-subtle bg-background/60 max-w-full truncate border px-1.5 py-0.5 text-[10px]"
							>
								{attachmentLabel(attachment, index)}
							</span>
						))}
					</div>
				) : null}
			</div>
		</div>
	);
}

function RunStrip({
	runId,
	run,
	events,
	error,
	basePath,
}: {
	runId: string | null;
	run: Doc | null;
	events: Doc[];
	error: string | null;
	basePath: string;
}) {
	if (!runId && events.length === 0 && !error) return null;

	const latestEvents = events.slice(-4).reverse();

	return (
		<div className="border-border-subtle border-t px-3 py-2">
			<div className="mb-2 flex items-center gap-2">
				<Icon icon="ph:pulse" className="text-muted-foreground size-3.5" />
				<span className="text-xs font-semibold">Run</span>
				{run?.status ? (
					<span className="text-muted-foreground ml-auto text-[11px]">
						{run.status}
					</span>
				) : null}
			</div>
			{runId ? (
				<AdminLink
					href={`${basePath}/collections/runs/${runId}`}
					className="text-muted-foreground hover:text-foreground mb-2 block truncate text-[11px]"
				>
					{runId}
				</AdminLink>
			) : null}
			{error ? (
				<div className="border-destructive/30 bg-destructive/10 text-destructive mb-2 border px-2 py-1.5 text-[11px]">
					{error}
				</div>
			) : null}
			<div className="space-y-1.5">
				{latestEvents.map((event) => (
					<div key={event.id} className="flex items-start gap-2 text-[11px]">
						<span
							className={[
								"mt-1 size-1.5 shrink-0 rounded-full",
								statusTone(event.level === "error" ? "failed" : run?.status),
							].join(" ")}
						/>
						<span className="min-w-0 flex-1">
							<span className="block truncate font-medium">{event.type}</span>
							{event.summary ? (
								<span className="text-muted-foreground line-clamp-2">
									{event.summary}
								</span>
							) : null}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

export default function AutopilotWorkRail({
	activeRoute,
	basePath: basePathProp,
}: AdminShellRailProps) {
	const client = useAdminStore(selectClient);
	const queryClient = useQueryClient();
	const storeBasePath = useAdminStore(selectBasePath);
	const basePath = basePathProp || storeBasePath;

	const [activeSessionId, setActiveSessionId] = React.useState<string | null>(
		null,
	);
	const [historyOpen, setHistoryOpen] = React.useState(false);
	const [composer, setComposer] = React.useState("");
	const [attachments, setAttachments] = React.useState<ChatAttachment[]>([]);
	const [dismissedContextKeys, setDismissedContextKeys] = React.useState<
		string[]
	>([]);
	const [activeRunId, setActiveRunId] = React.useState<string | null>(null);
	const [isDropActive, setIsDropActive] = React.useState(false);
	const [dropError, setDropError] = React.useState<string | null>(null);
	const messagesEndRef = React.useRef<HTMLDivElement | null>(null);

	const sessionsQuery = useQuery({
		queryKey: ["autopilot", "rail-chat", "sessions"],
		queryFn: () => loadSessions(client),
		enabled: !!client,
		staleTime: 20_000,
	});

	const messagesQuery = useQuery({
		queryKey: ["autopilot", "rail-chat", "messages", activeSessionId],
		queryFn: () => loadMessages(client, activeSessionId),
		enabled: !!client && !!activeSessionId,
	});

	const invalidateSessions = React.useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: ["autopilot", "rail-chat", "sessions"],
		});
	}, [queryClient]);

	const invalidateMessages = React.useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: ["autopilot", "rail-chat", "messages", activeSessionId],
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
		invalidateMessages,
		selectedMessagesWhere,
	);

	const sessions = sessionsQuery.data ?? [];
	const messages = messagesQuery.data ?? [];
	const { run, events, error: runError } = useRunStream(client, activeRunId);

	const contextAttachment = React.useMemo(
		() => routeAttachment(activeRoute),
		[activeRoute],
	);
	const contextAttachmentKey = contextAttachment
		? attachmentKey(contextAttachment)
		: null;
	const contextAttachments =
		contextAttachment &&
		(!contextAttachmentKey ||
			!dismissedContextKeys.includes(contextAttachmentKey))
			? [contextAttachment]
			: [];
	const outgoingAttachments = [...contextAttachments, ...attachments];

	const appendAttachments = React.useCallback((next: ChatAttachment[]) => {
		if (next.length === 0) return;
		setAttachments((prev) => {
			const seen = new Set(prev.map(attachmentKey));
			const merged = [...prev];
			for (const attachment of next) {
				const key = attachmentKey(attachment);
				if (seen.has(key)) continue;
				seen.add(key);
				merged.push(attachment);
			}
			return merged.slice(-20);
		});
		setHistoryOpen(false);
	}, []);

	React.useEffect(() => {
		if (typeof document === "undefined") return;

		let depth = 0;
		const handleDragEnter = (event: DragEvent) => {
			if (!event.dataTransfer || !hasDropPayload(event.dataTransfer)) return;
			event.preventDefault();
			depth++;
			setIsDropActive(true);
		};
		const handleDragOver = (event: DragEvent) => {
			if (!event.dataTransfer || !hasDropPayload(event.dataTransfer)) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = "copy";
			setIsDropActive(true);
		};
		const handleDragLeave = (event: DragEvent) => {
			if (!event.dataTransfer || !hasDropPayload(event.dataTransfer)) return;
			depth = Math.max(0, depth - 1);
			if (depth === 0) setIsDropActive(false);
		};
		const handleDrop = (event: DragEvent) => {
			if (!event.dataTransfer || !hasDropPayload(event.dataTransfer)) return;
			event.preventDefault();
			depth = 0;
			setIsDropActive(false);
			setDropError(null);
			void attachmentsFromDrop(event.dataTransfer)
				.then(appendAttachments)
				.catch((error) => {
					setDropError(
						error instanceof Error ? error.message : "Failed to attach drop",
					);
				});
		};

		document.addEventListener("dragenter", handleDragEnter);
		document.addEventListener("dragover", handleDragOver);
		document.addEventListener("dragleave", handleDragLeave);
		document.addEventListener("drop", handleDrop);
		return () => {
			document.removeEventListener("dragenter", handleDragEnter);
			document.removeEventListener("dragover", handleDragOver);
			document.removeEventListener("dragleave", handleDragLeave);
			document.removeEventListener("drop", handleDrop);
		};
	}, [appendAttachments]);

	React.useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ block: "end" });
	}, [messages.length]);

	React.useEffect(() => {
		if (activeRunId || messages.length === 0) return;
		const lastRunId = [...messages]
			.reverse()
			.map((message) => relationId(message.run))
			.find(Boolean);
		if (lastRunId) setActiveRunId(lastRunId);
	}, [activeRunId, messages]);

	const sendMutation = useMutation({
		mutationFn: async () => {
			const content =
				composer.trim() ||
				(outgoingAttachments.length > 0 ? "Use the attached context." : "");
			return (client as any).routes.chat({
				chatSessionId: activeSessionId ?? undefined,
				content,
				attachments: outgoingAttachments,
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
				setHistoryOpen(false);
			}
			if (result.runId) setActiveRunId(String(result.runId));
			setComposer("");
			setAttachments([]);
			invalidateSessions();
			invalidateMessages();
		},
	});

	const activeSession = sessions.find(
		(session) => session.id === activeSessionId,
	);
	const canSend =
		(composer.trim().length > 0 || outgoingAttachments.length > 0) &&
		!sendMutation.isPending;

	function startNewChat() {
		setActiveSessionId(null);
		setHistoryOpen(false);
		setComposer("");
		setAttachments([]);
		setActiveRunId(null);
		setDropError(null);
	}

	function selectSession(id: string) {
		setActiveSessionId(id);
		setHistoryOpen(false);
		setActiveRunId(null);
		setDropError(null);
	}

	function send() {
		if (!canSend) return;
		sendMutation.mutate();
	}

	return (
		<div
			className={[
				"bg-card/55 relative flex h-full min-h-0 flex-col",
				isDropActive ? "ring-primary/50 ring-2 ring-inset" : "",
			].join(" ")}
		>
			<div className="border-border-subtle flex h-14 shrink-0 items-center gap-2 border-b px-3">
				<div className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-md">
					<Icon icon="ph:chat-circle" className="size-4" />
				</div>
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-semibold">
						{historyOpen
							? "Chats"
							: activeSession
								? itemTitle(activeSession, "Untitled chat")
								: "Autopilot chat"}
					</p>
					<p className="text-muted-foreground truncate text-[11px]">
						Drop tasks, files, URLs, or text here
					</p>
				</div>
				<button
					type="button"
					onClick={() => setHistoryOpen((value) => !value)}
					className="text-muted-foreground hover:text-foreground flex size-7 items-center justify-center"
					title="Chat history"
				>
					<Icon icon="ph:clock-counter-clockwise" className="size-4" />
				</button>
				<button
					type="button"
					onClick={startNewChat}
					className="text-muted-foreground hover:text-foreground flex size-7 items-center justify-center"
					title="New chat"
				>
					<Icon icon="ph:plus" className="size-4" />
				</button>
			</div>

			{isDropActive ? (
				<div className="border-primary/30 bg-primary/10 text-primary absolute inset-x-3 top-16 z-10 border px-3 py-2 text-xs">
					Drop into Autopilot chat
				</div>
			) : null}

			{historyOpen ? (
				<div className="min-h-0 flex-1 overflow-y-auto p-2">
					{sessionsQuery.isLoading ? (
						<div className="text-muted-foreground px-2 py-6 text-center text-xs">
							Loading chats...
						</div>
					) : sessions.length === 0 ? (
						<div className="text-muted-foreground px-2 py-6 text-center text-xs">
							No chat sessions.
						</div>
					) : (
						sessions.map((session) => (
							<SessionRow
								key={session.id}
								session={session}
								active={session.id === activeSessionId}
								onSelect={() => selectSession(session.id)}
							/>
						))
					)}
				</div>
			) : (
				<div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
					{messages.length === 0 ? (
						<div className="text-muted-foreground flex h-full min-h-52 items-center justify-center text-center text-sm">
							<div>
								<Icon
									icon="ph:sparkle"
									className="text-primary mx-auto mb-3 size-5"
								/>
								<p>Ask from anywhere in admin.</p>
								<p className="mt-1 text-xs">
									Current record context is attached automatically.
								</p>
							</div>
						</div>
					) : (
						<div className="flex flex-col gap-3">
							{messages.map((message) => (
								<MessageBubble key={message.id} message={message} />
							))}
							<div ref={messagesEndRef} />
						</div>
					)}
				</div>
			)}

			<RunStrip
				runId={activeRunId}
				run={run}
				events={events}
				error={runError}
				basePath={basePath}
			/>

			<div className="border-border-subtle bg-card/70 shrink-0 border-t p-3">
				{dropError ? (
					<div className="text-destructive mb-2 text-xs">{dropError}</div>
				) : null}
				{outgoingAttachments.length > 0 ? (
					<div className="mb-2 flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
						{contextAttachments.map((attachment, index) => (
							<AttachmentChip
								key={`context-${attachmentKey(attachment)}-${index}`}
								attachment={attachment}
								index={index}
								onRemove={() => {
									if (contextAttachmentKey) {
										setDismissedContextKeys((prev) => [
											...prev,
											contextAttachmentKey,
										]);
									}
								}}
							/>
						))}
						{attachments.map((attachment, index) => (
							<AttachmentChip
								key={`${attachmentKey(attachment)}-${index}`}
								attachment={attachment}
								index={index}
								onRemove={() => {
									setAttachments((prev) =>
										prev.filter((_, itemIndex) => itemIndex !== index),
									);
								}}
							/>
						))}
					</div>
				) : null}

				<div className="control-surface focus-within:border-border-strong focus-within:ring-ring/20 overflow-hidden focus-within:ring-[3px]">
					<textarea
						value={composer}
						onChange={(event) => setComposer(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								send();
							}
						}}
						placeholder="Ask Autopilot..."
						rows={3}
						className="placeholder:text-muted-foreground min-h-20 w-full resize-none bg-transparent px-3 py-2 text-sm outline-none"
					/>
					<div className="border-border-subtle bg-muted/20 flex h-10 items-center gap-1 border-t px-2">
						<button
							type="button"
							className="text-muted-foreground hover:text-foreground flex size-7 items-center justify-center"
							onClick={() => setHistoryOpen(true)}
							title="Attach from history"
						>
							<Icon icon="ph:link-simple" className="size-4" />
						</button>
						<div className="flex-1" />
						{sendMutation.isError ? (
							<span className="text-destructive max-w-36 truncate text-[11px]">
								{sendMutation.error instanceof Error
									? sendMutation.error.message
									: "Message failed"}
							</span>
						) : null}
						<button
							type="button"
							disabled={!canSend}
							onClick={send}
							className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground flex size-7 items-center justify-center disabled:cursor-not-allowed"
							title="Send"
						>
							<Icon
								icon={sendMutation.isPending ? "ph:spinner" : "ph:arrow-up"}
								className={[
									"size-4",
									sendMutation.isPending ? "animate-spin" : "",
								].join(" ")}
							/>
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
