import { Icon } from "@iconify/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import {
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function eventMeta(event: Doc): Record<string, unknown> {
	if (isRecord(event.meta)) return event.meta;
	if (isRecord(event.metadata)) return event.metadata;
	return {};
}

function textFromRunEvents(events: Doc[]): string {
	let text = "";
	for (const event of events) {
		const meta = eventMeta(event);
		if (meta.type === "text.delta" && typeof meta.text === "string") {
			text += meta.text;
		}
	}
	return text;
}

function isActiveStatus(status: unknown): boolean {
	return status === "pending" || status === "claimed" || status === "running";
}

function InlineMarkdown({ text }: { text: string }) {
	const nodes: React.ReactNode[] = [];
	const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(text))) {
		if (match.index > lastIndex) {
			nodes.push(text.slice(lastIndex, match.index));
		}

		const token = match[0];
		if (token.startsWith("`")) {
			nodes.push(
				<code
					key={`${match.index}-code`}
					className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]"
				>
					{token.slice(1, -1)}
				</code>,
			);
		} else if (token.startsWith("**")) {
			nodes.push(
				<strong key={`${match.index}-strong`} className="font-semibold">
					{token.slice(2, -2)}
				</strong>,
			);
		} else {
			const labelEnd = token.indexOf("](");
			const label = token.slice(1, labelEnd);
			const href = token.slice(labelEnd + 2, -1);
			nodes.push(
				<a
					key={`${match.index}-link`}
					href={href}
					target="_blank"
					rel="noreferrer"
					className="text-primary underline underline-offset-2"
				>
					{label || href}
				</a>,
			);
		}

		lastIndex = match.index + token.length;
	}

	if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
	return <>{nodes}</>;
}

function MarkdownContent({ content }: { content: string }) {
	const lines = content.replace(/\r\n/g, "\n").split("\n");
	const blocks: React.ReactNode[] = [];
	let paragraph: string[] = [];
	let list: string[] = [];
	let code: string[] | null = null;
	let codeLang = "";

	const flushParagraph = () => {
		if (paragraph.length === 0) return;
		const value = paragraph.join(" ").trim();
		paragraph = [];
		if (!value) return;
		blocks.push(
			<p key={`p-${blocks.length}`} className="mb-2 last:mb-0">
				<InlineMarkdown text={value} />
			</p>,
		);
	};
	const flushList = () => {
		if (list.length === 0) return;
		const items = list;
		list = [];
		blocks.push(
			<ul key={`ul-${blocks.length}`} className="mb-2 list-disc space-y-1 pl-4">
				{items.map((item, index) => (
					<li key={`${index}-${item}`}>
						<InlineMarkdown text={item} />
					</li>
				))}
			</ul>,
		);
	};

	for (const line of lines) {
		const fence = line.match(/^```(\S*)?/);
		if (fence) {
			if (code) {
				const value = code.join("\n");
				code = null;
				blocks.push(
					<pre
						key={`code-${blocks.length}`}
						className="bg-muted mb-2 overflow-x-auto rounded-md p-2.5 font-mono text-[11px] leading-relaxed"
					>
						{codeLang ? (
							<div className="text-muted-foreground mb-1 text-[10px]">
								{codeLang}
							</div>
						) : null}
						<code>{value}</code>
					</pre>,
				);
				codeLang = "";
				continue;
			}
			flushParagraph();
			flushList();
			code = [];
			codeLang = fence[1] ?? "";
			continue;
		}

		if (code) {
			code.push(line);
			continue;
		}

		const trimmed = line.trim();
		if (!trimmed) {
			flushParagraph();
			flushList();
			continue;
		}

		const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
		if (heading) {
			flushParagraph();
			flushList();
			const level = heading[1].length;
			const Tag = level === 1 ? "h3" : level === 2 ? "h4" : "h5";
			blocks.push(
				<Tag
					key={`h-${blocks.length}`}
					className="mt-3 mb-1 text-sm font-semibold first:mt-0"
				>
					<InlineMarkdown text={heading[2]} />
				</Tag>,
			);
			continue;
		}

		const bullet = trimmed.match(/^[-*]\s+(.+)$/);
		if (bullet) {
			flushParagraph();
			list.push(bullet[1]);
			continue;
		}

		flushList();
		paragraph.push(trimmed);
	}

	if (code) {
		blocks.push(
			<pre
				key={`code-${blocks.length}`}
				className="bg-muted mb-2 overflow-x-auto rounded-md p-2.5 font-mono text-[11px] leading-relaxed"
			>
				<code>{code.join("\n")}</code>
			</pre>,
		);
	}
	flushParagraph();
	flushList();

	return <div className="text-sm leading-relaxed break-words">{blocks}</div>;
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
			className="border-border-subtle bg-card hover:bg-muted flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors"
			title="Remove attachment"
		>
			<Icon icon={icon} className="size-3 shrink-0" />
			<span className="max-w-56 truncate">
				{attachmentLabel(attachment, index)}
			</span>
			<Icon icon="ph:x" className="size-3 shrink-0" />
		</button>
	);
}

function AttachmentSummary({ attachments }: { attachments: ChatAttachment[] }) {
	if (attachments.length === 0) return null;
	const first = attachmentLabel(attachments[0], 0);
	const label =
		attachments.length === 1 ? first : `${first} +${attachments.length - 1}`;
	return (
		<div className="text-muted-foreground mt-2 inline-flex max-w-full items-center gap-1.5 text-[11px]">
			<Icon icon="ph:paperclip" className="size-3 shrink-0" />
			<span className="truncate">{label}</span>
		</div>
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
				"mb-1 flex min-h-12 w-full items-start gap-2 rounded-md px-3 py-2 text-left transition-colors",
				active
					? "bg-[var(--sidebar-active-background)] text-[var(--sidebar-active-foreground)]"
					: "hover:bg-muted/50",
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
	const content = typeof message.content === "string" ? message.content : "";

	return (
		<div
			className={["flex", isUser ? "justify-end" : "justify-start"].join(" ")}
		>
			<div
				className={[
					"max-w-[92%] rounded-xl px-3 py-2 shadow-xs",
					isUser
						? "bg-primary/10 text-foreground"
						: "border-border-subtle bg-card border text-foreground",
				].join(" ")}
			>
				{isUser ? (
					<div className="text-sm leading-relaxed break-words whitespace-pre-wrap">
						{content}
					</div>
				) : (
					<MarkdownContent content={content} />
				)}
				<AttachmentSummary attachments={attachments} />
			</div>
		</div>
	);
}

function StreamingMessage({
	text,
	isStreaming,
}: {
	text: string;
	isStreaming: boolean;
}) {
	if (!text && !isStreaming) return null;

	return (
		<div className="flex justify-start">
			<div className="border-border-subtle bg-card max-w-[92%] rounded-xl border px-3 py-2 shadow-xs">
				{text ? <MarkdownContent content={text} /> : null}
				{isStreaming ? (
					<span className="text-primary mt-1 inline-flex items-center gap-1.5 text-[11px]">
						<span className="bg-primary inline-block size-1.5 animate-pulse rounded-full" />
						<span>Streaming</span>
					</span>
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
}: {
	runId: string | null;
	run: Doc | null;
	events: Doc[];
	error: string | null;
}) {
	if (!runId && events.length === 0 && !error) return null;

	const status = String(run?.status ?? "");
	const latest =
		[...events].reverse().find((event) => {
			const meta = eventMeta(event);
			return meta.type !== "text.delta" && meta.type !== "thinking.delta";
		}) ?? null;

	if (!error && status === "completed") return null;

	return (
		<div className="text-muted-foreground mx-3 mb-2 flex items-center gap-2 text-[11px]">
			<span
				className={[
					"size-1.5 shrink-0 rounded-full",
					error ? "bg-destructive" : statusTone(run?.status),
				].join(" ")}
			/>
			{error ? (
				<span className="text-destructive min-w-0 truncate">{error}</span>
			) : (
				<span className="min-w-0 truncate">
					{latest?.summary ?? (status ? `Run ${status}` : "Working")}
				</span>
			)}
		</div>
	);
}

export default function AutopilotWorkRail({
	activeRoute,
}: AdminShellRailProps) {
	const client = useAdminStore(selectClient);
	const queryClient = useQueryClient();

	const [activeSessionId, setActiveSessionId] = React.useState<string | null>(
		null,
	);
	const [historyOpen, setHistoryOpen] = React.useState(false);
	const [sessionSearch, setSessionSearch] = React.useState("");
	const [composer, setComposer] = React.useState("");
	const [attachments, setAttachments] = React.useState<ChatAttachment[]>([]);
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

	const sessions = React.useMemo(
		() => sessionsQuery.data ?? [],
		[sessionsQuery.data],
	);
	const messages = React.useMemo(
		() => messagesQuery.data ?? [],
		[messagesQuery.data],
	);
	const filteredSessions = React.useMemo(() => {
		const query = sessionSearch.trim().toLowerCase();
		if (!query) return sessions;
		return sessions.filter((session) =>
			[
				itemTitle(session, "Untitled chat"),
				String(session.status ?? ""),
				String(session.scopeType ?? ""),
			]
				.join(" ")
				.toLowerCase()
				.includes(query),
		);
	}, [sessions, sessionSearch]);
	const { run, events, error: runError } = useRunStream(client, activeRunId);
	const streamingText = React.useMemo(
		() => textFromRunEvents(events),
		[events],
	);

	const contextAttachment = React.useMemo(
		() => routeAttachment(activeRoute),
		[activeRoute],
	);
	const contextAttachments = contextAttachment ? [contextAttachment] : [];
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
	}, [messages.length, streamingText]);

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
	const isNewChatEmpty =
		!historyOpen &&
		!activeSession &&
		composer.trim().length === 0 &&
		attachments.length === 0;
	const showNewButton = historyOpen || !!activeSession || !isNewChatEmpty;
	const hasAssistantForActiveRun =
		!!activeRunId &&
		messages.some(
			(message) =>
				String(message.role ?? "") === "assistant" &&
				relationId(message.run) === activeRunId,
		);
	const showStreamingMessage =
		!!activeRunId &&
		!hasAssistantForActiveRun &&
		(streamingText.trim().length > 0 || !run || isActiveStatus(run.status));
	const isStreaming = !!activeRunId && (!run || isActiveStatus(run.status));

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

	const title = historyOpen
		? "Chats"
		: activeSession
			? itemTitle(activeSession, "Untitled chat")
			: "";

	return (
		<div className="bg-background flex h-full min-h-0 flex-col p-2">
			<div
				className={[
					"bg-card/60 ring-border/40 relative flex h-full min-h-0 flex-col overflow-hidden rounded-[20px] shadow-xs ring-1",
					isDropActive ? "ring-primary/50 ring-2" : "",
				].join(" ")}
			>
				<div className="flex h-10 shrink-0 items-center gap-2 px-3">
					{activeSession && !historyOpen ? (
						<button
							type="button"
							onClick={startNewChat}
							className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
							title="Back"
						>
							<Icon icon="ph:arrow-left" className="size-4" />
						</button>
					) : null}
					{historyOpen ? (
						<div className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-md">
							<Icon icon="ph:chat-circle" className="size-4" />
						</div>
					) : null}
					<div className="min-w-0 flex-1">
						{title ? (
							<p className="truncate text-sm font-semibold">{title}</p>
						) : null}
					</div>
					<button
						type="button"
						onClick={() => setHistoryOpen((value) => !value)}
						className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
						title="Chat history"
					>
						<Icon icon="ph:clock-counter-clockwise" className="size-4" />
					</button>
					{showNewButton ? (
						<button
							type="button"
							onClick={startNewChat}
							className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
							title="New chat"
						>
							<Icon icon="ph:plus" className="size-4" />
						</button>
					) : null}
				</div>

				{isDropActive ? (
					<div className="border-primary/30 bg-primary/10 text-primary absolute inset-x-3 top-14 z-10 rounded-xl border px-3 py-2 text-xs shadow-sm">
						Drop into Autopilot chat
					</div>
				) : null}

				{historyOpen ? (
					<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
						<div className="shrink-0 px-3 pb-2">
							<div className="control-surface focus-within:border-border-strong focus-within:ring-ring/20 flex h-9 items-center gap-2 px-2.5 focus-within:ring-[3px]">
								<Icon
									icon="ph:magnifying-glass"
									className="text-muted-foreground size-3.5 shrink-0"
								/>
								<input
									value={sessionSearch}
									onChange={(event) => setSessionSearch(event.target.value)}
									placeholder="Search chats..."
									className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-xs outline-none"
								/>
								{sessionSearch ? (
									<button
										type="button"
										onClick={() => setSessionSearch("")}
										className="text-muted-foreground hover:text-foreground flex size-5 items-center justify-center"
										title="Clear search"
									>
										<Icon icon="ph:x" className="size-3" />
									</button>
								) : null}
							</div>
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
							{sessionsQuery.isLoading ? (
								<div className="text-muted-foreground px-2 py-6 text-center text-xs">
									Loading chats...
								</div>
							) : sessions.length === 0 ? (
								<div className="text-muted-foreground px-2 py-6 text-center text-xs">
									No chat sessions.
								</div>
							) : filteredSessions.length === 0 ? (
								<div className="text-muted-foreground px-2 py-6 text-center text-xs">
									No matching chats.
								</div>
							) : (
								filteredSessions.map((session) => (
									<SessionRow
										key={session.id}
										session={session}
										active={session.id === activeSessionId}
										onSelect={() => selectSession(session.id)}
									/>
								))
							)}
						</div>
					</div>
				) : (
					<div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
						{messages.length === 0 ? (
							<div className="flex h-full min-h-52 items-center justify-center text-center">
								<div className="text-primary bg-primary/10 flex size-8 items-center justify-center rounded-xl">
									<Icon icon="ph:sparkle" className="size-4" />
								</div>
							</div>
						) : (
							<div className="flex flex-col gap-3">
								{messages.map((message) => (
									<MessageBubble key={message.id} message={message} />
								))}
								{showStreamingMessage ? (
									<StreamingMessage
										text={streamingText}
										isStreaming={isStreaming}
									/>
								) : null}
								<div ref={messagesEndRef} />
							</div>
						)}
					</div>
				)}

				{!historyOpen ? (
					<RunStrip
						runId={activeRunId}
						run={run}
						events={events}
						error={runError}
					/>
				) : null}

				{!historyOpen ? (
					<div className="shrink-0 px-3 pb-3">
						{dropError ? (
							<div className="text-destructive mb-2 text-xs">{dropError}</div>
						) : null}
						<div className="border-border-subtle bg-card focus-within:border-border-strong focus-within:ring-ring/20 overflow-hidden rounded-xl border shadow-sm transition-[background-color,border-color,box-shadow] focus-within:ring-[3px]">
							{attachments.length > 0 ? (
								<div className="border-border-subtle flex max-h-20 flex-wrap gap-1.5 overflow-y-auto border-b px-3 py-2.5">
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
							<textarea
								value={composer}
								onChange={(event) => setComposer(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter" && !event.shiftKey) {
										event.preventDefault();
										send();
									}
								}}
								placeholder="Ask anything or create work..."
								rows={1}
								className="placeholder:text-muted-foreground field-sizing-content max-h-32 min-h-11 w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-sm leading-relaxed outline-none disabled:cursor-not-allowed disabled:opacity-50"
								disabled={sendMutation.isPending}
							/>
							<div className="border-border-subtle bg-muted/20 flex min-h-9 items-center gap-1 border-t px-2 py-1">
								{contextAttachments.length > 0 ? (
									<span
										className="text-muted-foreground flex size-6 items-center justify-center"
										title="Current page context is attached"
									>
										<Icon icon="ph:crosshair" className="size-3.5" />
									</span>
								) : null}
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
									className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed"
									title="Send"
								>
									<Icon
										icon={sendMutation.isPending ? "ph:spinner" : "ph:arrow-up"}
										className={[
											"size-3.5",
											sendMutation.isPending ? "animate-spin" : "",
										].join(" ")}
									/>
									<span>{sendMutation.isPending ? "Sending" : "Send"}</span>
								</button>
							</div>
						</div>
					</div>
				) : null}
			</div>
		</div>
	);
}
