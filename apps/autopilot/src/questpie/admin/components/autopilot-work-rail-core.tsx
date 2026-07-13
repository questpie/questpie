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
import {
	useAutopilotChat,
	type AutopilotRunInfo,
	type AutopilotUIMessage,
} from "../hooks/use-autopilot-chat";
import { MessageParts, messageText } from "./message-parts";

type Doc = Record<string, any>;

export interface AutopilotWorkRailCoreProps {
	activeRoute?: string;
	client: unknown;
	queryClient: QueryClient;
}

// ── Helpers ───────────────────────────────────────────────────

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

function AttachmentSummary({
	attachments,
}: {
	attachments: ChatAttachment[] | undefined;
}) {
	if (!attachments || attachments.length === 0) return null;
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
				<span
					title={itemTitle(session, "Untitled chat")}
					className="block truncate text-xs font-medium"
				>
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

function MessageBubble({
	message,
	onAnswer,
	live = false,
}: {
	message: AutopilotUIMessage;
	onAnswer?: (answer: string) => void;
	live?: boolean;
}) {
	const isUser = message.role === "user";
	const attachments = message.metadata?.attachments;
	const runStatus = message.metadata?.runStatus;
	// Failed turns persist an assistant row (badge lives there); cancelled
	// turns never do (finalize latch), so the cancel route marks the USER row.
	const showBadge = isUser
		? runStatus === "cancelled"
		: runStatus === "failed" || runStatus === "cancelled";

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
						{messageText(message)}
					</div>
				) : (
					<MessageParts message={message} onAnswer={onAnswer} live={live} />
				)}
				{showBadge ? (
					<div className="text-destructive mt-1 inline-flex items-center gap-1 text-[11px]">
						<Icon
							icon={runStatus === "failed" ? "ph:warning-circle" : "ph:prohibit"}
							className="size-3"
						/>
						<span>{runStatus === "failed" ? "Failed" : "Cancelled"}</span>
					</div>
				) : null}
				<AttachmentSummary attachments={attachments} />
			</div>
		</div>
	);
}

/**
 * TurnStatusStrip — the live-turn footer (§4.2 submitted/queued states + §4.3
 * chip + §4.4 cancel + failed-turn retry).
 */
function TurnStatusStrip({
	status,
	runInfo,
	error,
	streamExpired,
	onCancel,
	onRetry,
}: {
	status: string;
	runInfo: AutopilotRunInfo | null;
	error: Error | undefined;
	streamExpired: boolean;
	onCancel: () => void;
	onRetry: () => void;
}) {
	const busy = status === "submitted" || status === "streaming";
	const runActive =
		!!runInfo && ["pending", "claimed", "running"].includes(runInfo.status);

	if (!busy && !runActive && !error && !streamExpired) return null;

	if (error) {
		return (
			<div className="text-destructive mx-3 mb-2 flex items-center gap-2 text-[11px]">
				<span className="bg-destructive size-1.5 shrink-0 rounded-full" />
				<span className="min-w-0 flex-1 truncate" title={error.message}>
					{error.message || "The turn failed"}
				</span>
				<button
					type="button"
					onClick={onRetry}
					className="hover:text-foreground shrink-0 underline"
				>
					Retry
				</button>
			</div>
		);
	}

	if (streamExpired && !busy) {
		return (
			<div className="text-muted-foreground mx-3 mb-2 flex items-center gap-2 text-[11px]">
				<Icon icon="ph:clock-countdown" className="size-3 shrink-0" />
				<span className="min-w-0 truncate">
					Live stream expired — showing saved output
				</span>
			</div>
		);
	}

	let label = "Working...";
	let hint: string | null = null;
	if (runInfo?.status === "pending" || (status === "submitted" && !runInfo)) {
		label = "Queued — waiting for a worker...";
		const createdAt = runInfo?.createdAt
			? new Date(runInfo.createdAt).getTime()
			: null;
		if (createdAt && Date.now() - createdAt > 10_000) {
			hint = "No worker has picked this up yet";
		}
	} else if (runInfo?.status === "claimed") {
		label = "Starting...";
	}

	return (
		<div className="text-muted-foreground mx-3 mb-2 flex items-center gap-2 text-[11px]">
			<span className="bg-info size-1.5 shrink-0 animate-pulse rounded-full" />
			<span className="min-w-0 truncate">{hint ?? label}</span>
			{runInfo?.worker ? (
				<span className="text-muted-foreground/70 hidden shrink-0 truncate sm:inline">
					{runInfo.worker.slice(0, 8)}
				</span>
			) : null}
			{runInfo ? (
				<a
					href={`/admin/run-detail?run=${encodeURIComponent(runInfo.id)}`}
					className="text-muted-foreground hover:text-foreground ml-auto shrink-0 text-[10px] underline"
					title="Open run detail"
				>
					Details
				</a>
			) : null}
			<button
				type="button"
				onClick={onCancel}
				className={[
					"text-muted-foreground hover:text-foreground shrink-0 text-[10px] underline",
					runInfo ? "" : "ml-auto",
				].join(" ")}
			>
				Cancel
			</button>
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
	const scrollRef = React.useRef<HTMLDivElement | null>(null);
	const nearBottomRef = React.useRef(true);
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

	// Stick-to-bottom that releases on scroll-up (§4.2): only auto-scroll on
	// message growth while the user is already near the bottom.
	const handleScroll = React.useCallback(() => {
		const node = scrollRef.current;
		if (!node) return;
		nearBottomRef.current =
			node.scrollHeight - node.scrollTop - node.clientHeight <= 48;
	}, []);

	React.useEffect(() => {
		const node = scrollRef.current;
		if (!node || !nearBottomRef.current) return;
		node.scrollTop = node.scrollHeight;
	}, [chat.messages]);

	const activeSession = chat.sessions.find(
		(session) => session.id === chat.activeSessionId,
	);
	const isBusy = chat.status === "submitted" || chat.status === "streaming";
	const canSend =
		(composer.trim().length > 0 || outgoingAttachments.length > 0) && !isBusy;
	const isNewChatEmpty =
		!historyOpen &&
		!activeSession &&
		composer.trim().length === 0 &&
		attachments.length === 0;
	const showNewButton = historyOpen || !!activeSession || !isNewChatEmpty;

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
		nearBottomRef.current = true;
	}

	const answerQuestion = React.useCallback(
		(answer: string) => {
			chat.send(answer, []);
			nearBottomRef.current = true;
		},
		[chat],
	);

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
					<div
						ref={scrollRef}
						onScroll={handleScroll}
						className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
					>
						{chat.messages.length === 0 ? (
							<div className="flex h-full min-h-52 flex-col items-center justify-center gap-3 px-6 text-center">
								<div className="text-primary bg-primary/10 ring-primary/10 flex size-11 items-center justify-center rounded-2xl ring-1">
									<Icon icon="ph:sparkle" className="size-5" />
								</div>
								<div className="max-w-[15rem] space-y-1">
									<p className="text-sm font-semibold">Ask Autopilot anything</p>
									<p className="text-muted-foreground text-xs leading-relaxed">
										Create work, ask about a task, or drop a file or record to
										add context.
									</p>
								</div>
							</div>
						) : (
							<div className="flex flex-col gap-3">
								{chat.messages.map((message, index) => {
									const isLast = index === chat.messages.length - 1;
									const isAssistant = message.role === "assistant";
									return (
										<MessageBubble
											key={message.id}
											message={message}
											// The trailing tool chain collapses to a single live
											// line only while this message is actively streaming.
											live={isLast && isAssistant && isBusy}
											// AskUserQuestion options are clickable only on the LAST
											// message while idle — the answer goes out as a new turn.
											onAnswer={
												isLast && isAssistant && !isBusy
													? answerQuestion
													: undefined
											}
										/>
									);
								})}
							</div>
						)}
					</div>
				)}

				{!historyOpen ? (
					<TurnStatusStrip
						status={chat.status}
						runInfo={chat.runInfo}
						error={chat.error}
						streamExpired={chat.streamExpired}
						onCancel={chat.cancel}
						onRetry={chat.retry}
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
								className="placeholder:text-muted-foreground field-sizing-content max-h-32 min-h-9 w-full resize-none bg-transparent px-3 pt-2 pb-1 text-base leading-relaxed outline-none disabled:cursor-not-allowed disabled:opacity-50"
							/>
							<div className="border-border-subtle bg-muted/20 flex min-h-8 items-center gap-1 border-t px-2 py-1">
								<button
									type="button"
									onClick={openFilePicker}
									disabled={isBusy}
									className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50"
									title="Attach file"
								>
									<Icon icon="ph:paperclip" className="size-3.5" />
								</button>
								{contextAttachments.length > 0 ? (
									<span
										className="text-muted-foreground flex size-7 items-center justify-center"
										title="Current page context is attached"
									>
										<Icon icon="ph:crosshair" className="size-3.5" />
									</span>
								) : null}
								<div className="flex-1" />
								<button
									type="button"
									disabled={!canSend}
									onClick={send}
									className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed"
									title="Send"
								>
									<Icon
										icon={isBusy ? "ph:spinner" : "ph:arrow-up"}
										className={["size-3.5", isBusy ? "animate-spin" : ""].join(
											" ",
										)}
									/>
									<span>{isBusy ? "Working" : "Send"}</span>
								</button>
							</div>
						</div>
					</div>
				) : null}
			</div>
		</div>
	);
}
