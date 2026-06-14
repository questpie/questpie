import { Icon } from "@iconify/react";
import type { QueryClient } from "@tanstack/react-query";
import * as React from "react";

import {
	CHAT_ATTACHMENT_DRAG_MIME,
	CHAT_ATTACHMENT_EVENT,
	chatAttachmentKey as attachmentKey,
	chatAttachmentLabel as attachmentLabel,
	type ChatAttachment,
} from "../lib/chat-attachments";
import { useAutopilotChat } from "../hooks/use-autopilot-chat";

type Doc = Record<string, any>;

export interface AutopilotWorkRailCoreProps {
	activeRoute?: string;
	client: unknown;
	queryClient: QueryClient;
}

// ── Helpers ───────────────────────────────────────────────────

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

// ── Markdown rendering ────────────────────────────────────────

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

// ── Attachment helpers ────────────────────────────────────────

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
				return [{ source: "drag", ...(parsed as ChatAttachment) }];
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

// ── UI components ─────────────────────────────────────────────

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
					isUser ? "max-w-[86%] rounded-lg px-3 py-2" : "w-full px-1 py-1",
					isUser ? "bg-primary/10 text-foreground" : "text-foreground",
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
			<div className="w-full px-1 py-1">
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

function StreamStrip({
	isStreaming,
	streamError,
	onCancel,
}: {
	isStreaming: boolean;
	streamError: string | null;
	onCancel: () => void;
}) {
	if (!isStreaming && !streamError) return null;

	return (
		<div className="text-muted-foreground mx-3 mb-2 flex items-center gap-2 text-[11px]">
			<span
				className={[
					"size-1.5 shrink-0 rounded-full",
					streamError ? "bg-destructive" : "bg-info",
				].join(" ")}
			/>
			{streamError ? (
				<span className="text-destructive min-w-0 truncate">{streamError}</span>
			) : (
				<span className="min-w-0 truncate">Working...</span>
			)}
			{isStreaming ? (
				<button
					type="button"
					onClick={onCancel}
					className="text-muted-foreground hover:text-foreground ml-auto text-[10px] underline"
				>
					Cancel
				</button>
			) : null}
		</div>
	);
}

// ── Main component ────────────────────────────────────────────

export function AutopilotWorkRailCore({
	activeRoute,
	client,
	queryClient,
}: AutopilotWorkRailCoreProps) {
	const chat = useAutopilotChat({ client, queryClient, activeRoute });
	const [historyOpen, setHistoryOpen] = React.useState(false);
	const [sessionSearch, setSessionSearch] = React.useState("");
	const [composer, setComposer] = React.useState("");
	const [attachments, setAttachments] = React.useState<ChatAttachment[]>([]);
	const [isDropActive, setIsDropActive] = React.useState(false);
	const [dropError, setDropError] = React.useState<string | null>(null);
	const messagesEndRef = React.useRef<HTMLDivElement | null>(null);
	const fileInputRef = React.useRef<HTMLInputElement | null>(null);

	const filteredSessions = React.useMemo(() => {
		const query = sessionSearch.trim().toLowerCase();
		if (!query) return chat.sessions;
		return chat.sessions.filter((session) =>
			[
				itemTitle(session, "Untitled chat"),
				String(session.status ?? ""),
				String(session.scopeType ?? ""),
			]
				.join(" ")
				.toLowerCase()
				.includes(query),
		);
	}, [chat.sessions, sessionSearch]);

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
		if (typeof window === "undefined") return;

		const handleAttach = (event: Event) => {
			const attachment = (event as CustomEvent<ChatAttachment>).detail;
			if (!attachment || typeof attachment !== "object") return;
			appendAttachments([attachment]);
		};

		window.addEventListener(CHAT_ATTACHMENT_EVENT, handleAttach);
		return () =>
			window.removeEventListener(CHAT_ATTACHMENT_EVENT, handleAttach);
	}, [appendAttachments]);

	const openFilePicker = React.useCallback(() => {
		fileInputRef.current?.click();
	}, []);

	const handleFileInput = React.useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const files = Array.from(event.currentTarget.files ?? []);
			event.currentTarget.value = "";
			if (files.length === 0) return;
			setDropError(null);
			void Promise.all(files.map(attachmentFromFile))
				.then(appendAttachments)
				.catch((error) => {
					setDropError(
						error instanceof Error ? error.message : "Failed to attach file",
					);
				});
		},
		[appendAttachments],
	);

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
	}, [chat.messages.length, chat.streamingText]);

	const activeSession = chat.sessions.find(
		(session) => session.id === chat.activeSessionId,
	);
	const canSend =
		(composer.trim().length > 0 || outgoingAttachments.length > 0) &&
		!chat.isSending;
	const isNewChatEmpty =
		!historyOpen &&
		!activeSession &&
		composer.trim().length === 0 &&
		attachments.length === 0;
	const showNewButton = historyOpen || !!activeSession || !isNewChatEmpty;
	const showStreamingMessage =
		chat.streamingText.trim().length > 0 || chat.isStreaming;

	function startNewChat() {
		chat.setActiveSessionId(null);
		setHistoryOpen(false);
		setComposer("");
		setAttachments([]);
		setDropError(null);
	}

	function selectSession(id: string) {
		chat.setActiveSessionId(id);
		setHistoryOpen(false);
		setDropError(null);
	}

	function send() {
		if (!canSend) return;
		const content =
			composer.trim() ||
			(outgoingAttachments.length > 0 ? "Use the attached context." : "");
		chat.send(content, outgoingAttachments);
		setComposer("");
		setAttachments([]);
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
							{chat.sessionsLoading ? (
								<div className="text-muted-foreground px-2 py-6 text-center text-xs">
									Loading chats...
								</div>
							) : chat.sessions.length === 0 ? (
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
										active={session.id === chat.activeSessionId}
										onSelect={() => selectSession(session.id)}
									/>
								))
							)}
						</div>
					</div>
				) : (
					<div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
						{chat.messages.length === 0 ? (
							<div className="flex h-full min-h-52 items-center justify-center text-center">
								<div className="text-primary bg-primary/10 flex size-8 items-center justify-center rounded-xl">
									<Icon icon="ph:sparkle" className="size-4" />
								</div>
							</div>
						) : (
							<div className="flex flex-col gap-3">
								{chat.messages.map((message) => (
									<MessageBubble key={message.id} message={message} />
								))}
								{showStreamingMessage ? (
									<StreamingMessage
										text={chat.streamingText}
										isStreaming={chat.isStreaming}
									/>
								) : null}
								<div ref={messagesEndRef} />
							</div>
						)}
					</div>
				)}

				{!historyOpen ? (
					<StreamStrip
						isStreaming={chat.isStreaming}
						streamError={chat.streamError}
						onCancel={chat.cancel}
					/>
				) : null}

				{!historyOpen ? (
					<div className="shrink-0 px-3 pb-3">
						{dropError ? (
							<div className="text-destructive mb-2 text-xs">{dropError}</div>
						) : null}
						<input
							ref={fileInputRef}
							type="file"
							multiple
							onChange={handleFileInput}
							className="hidden"
							tabIndex={-1}
						/>
						<div className="border-border-subtle bg-card focus-within:border-border-strong focus-within:ring-ring/20 overflow-hidden rounded-lg border transition-[background-color,border-color,box-shadow] focus-within:ring-[3px]">
							{attachments.length > 0 ? (
								<div className="border-border-subtle flex max-h-20 flex-wrap gap-1.5 overflow-y-auto border-b px-2.5 py-2">
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
								className="placeholder:text-muted-foreground field-sizing-content max-h-32 min-h-9 w-full resize-none bg-transparent px-3 pt-2 pb-1 text-sm leading-relaxed outline-none disabled:cursor-not-allowed disabled:opacity-50"
								disabled={chat.isSending}
							/>
							<div className="border-border-subtle bg-muted/20 flex min-h-8 items-center gap-1 border-t px-2 py-1">
								<button
									type="button"
									onClick={openFilePicker}
									disabled={chat.isSending}
									className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-6 shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50"
									title="Attach file"
								>
									<Icon icon="ph:paperclip" className="size-3.5" />
								</button>
								{contextAttachments.length > 0 ? (
									<span
										className="text-muted-foreground flex size-6 items-center justify-center"
										title="Current page context is attached"
									>
										<Icon icon="ph:crosshair" className="size-3.5" />
									</span>
								) : null}
								<div className="flex-1" />
								{chat.sendError ? (
									<span className="text-destructive max-w-36 truncate text-[11px]">
										{chat.sendError}
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
										icon={chat.isSending ? "ph:spinner" : "ph:arrow-up"}
										className={[
											"size-3.5",
											chat.isSending ? "animate-spin" : "",
										].join(" ")}
									/>
									<span>{chat.isSending ? "Sending" : "Send"}</span>
								</button>
							</div>
						</div>
					</div>
				) : null}
			</div>
		</div>
	);
}
