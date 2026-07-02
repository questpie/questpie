/**
 * MessageParts — renders a UIMessage's `parts` array (§4.2).
 *
 * Shared by the work-rail chat, the mobile chat page, and the run-detail
 * transcript (T10). Text parts render through Streamdown (streaming-safe
 * markdown); tool parts render through a per-tool REGISTRY (claude-code
 * builtins get purpose-built cards, MCP/unknown tools a generic one);
 * unknown part types render nothing (degraded mode: a broken part never
 * blanks the bubble).
 *
 * AskUserQuestion is interactive: the harness auto-resolves the tool call
 * headlessly and the model ends its turn waiting for the answer as the NEXT
 * user message — so the card renders the options as buttons and `onAnswer`
 * (wired by the chat surfaces, absent in read-only run-detail) sends the
 * choice as a new turn. The harness session resumes from its checkpoint.
 */

import { Icon } from "@iconify/react";
import * as React from "react";
import { Streamdown } from "streamdown";

type UIMessageLike = {
	id: string;
	role: string;
	parts?: unknown;
	metadata?: unknown;
};

type PartLike = Record<string, unknown> & { type: string };

function partsOf(message: UIMessageLike): PartLike[] {
	if (!Array.isArray(message.parts)) return [];
	return message.parts.filter(
		(part): part is PartLike =>
			!!part && typeof part === "object" && typeof (part as any).type === "string",
	);
}

export function messageText(message: UIMessageLike): string {
	return partsOf(message)
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text as string)
		.join("");
}

function toolName(part: PartLike): string {
	if (part.type === "dynamic-tool" && typeof part.toolName === "string") {
		return part.toolName;
	}
	return part.type.startsWith("tool-") ? part.type.slice(5) : part.type;
}

/**
 * Claude-code registers file/shell tools under LOWERCASE sdk keys (`read`,
 * `bash`, `edit`, `write`, `grep`, `glob`, `webSearch`) but others under
 * capitalized ones (`AskUserQuestion`, `TodoWrite`, `Task`, `WebFetch`…), so
 * the `tool-{name}` part casing is mixed. Match on a canonical lowercase key
 * and prettify the display name separately.
 */
const PRETTY_TOOL_NAMES: Record<string, string> = {
	read: "Read",
	write: "Write",
	edit: "Edit",
	bash: "Bash",
	grep: "Grep",
	glob: "Glob",
	websearch: "Web search",
	webfetch: "Web fetch",
	notebookedit: "Notebook edit",
	exitplanmode: "Plan",
	todowrite: "Todos",
	askuserquestion: "Question",
};

function prettyToolName(name: string): string {
	return PRETTY_TOOL_NAMES[name.toLowerCase()] ?? name;
}

/** Human tool label for lines/summaries — unwraps `mcp__server__tool` too. */
function toolDisplayName(part: PartLike): string {
	const raw = toolName(part);
	const mcp = mcpLabel(raw);
	return mcp ? mcp.tool : prettyToolName(raw);
}

/**
 * "Activity" tools (read/edit/bash/grep/todos/subagents/mcp…) collapse into a
 * single live line while running and a consolidated summary once the chain
 * ends. AskUserQuestion (interactive) and ExitPlanMode (a plan the user should
 * read) are NOT activity — they always render as their full standalone card.
 */
function isActivityTool(part: PartLike): boolean {
	if (part.type !== "dynamic-tool" && !part.type.startsWith("tool-")) {
		return false;
	}
	const name = toolName(part).toLowerCase();
	return name !== "askuserquestion" && name !== "exitplanmode";
}

/** Short target for the one-line tool label (path tail / command / query). */
function toolTarget(part: PartLike): string {
	const input = asRecord(part.input);
	const raw =
		str(input.command) ||
		str(input.file_path) ||
		str(input.notebook_path) ||
		str(input.pattern) ||
		str(input.query) ||
		str(input.url) ||
		str(input.title) ||
		str(input.description) ||
		str(input.skill);
	if (!raw) return "";
	const value = raw.includes("/") ? raw.split("/").slice(-2).join("/") : raw;
	return value.length > 52 ? `${value.slice(0, 52)}…` : value;
}

/** `mcp__server__tool` → { tool, server } for a readable MCP label. */
function mcpLabel(name: string): { tool: string; server: string } | null {
	const match = name.match(/^mcp__(.+?)__(.+)$/);
	if (!match) return null;
	return { server: match[1], tool: match[2] };
}

function toolStateMeta(state: unknown): { label: string; tone: string } {
	switch (state) {
		case "input-streaming":
			return { label: "Preparing", tone: "text-info" };
		case "input-available":
			return { label: "Running", tone: "text-info" };
		case "output-available":
			return { label: "Done", tone: "text-success" };
		case "output-error":
			return { label: "Failed", tone: "text-destructive" };
		default:
			return { label: "", tone: "text-muted-foreground" };
	}
}

function isRunning(state: unknown): boolean {
	return state === "input-streaming" || state === "input-available";
}

function compactJson(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

function str(value: unknown): string {
	return typeof value === "string" ? value : "";
}

// ── Shared card chrome ────────────────────────────────────────

function ToolCard({
	icon,
	title,
	subtitle,
	state,
	children,
	defaultOpen = false,
	collapsible = true,
}: {
	icon: string;
	title: string;
	subtitle?: string;
	state: unknown;
	children?: React.ReactNode;
	defaultOpen?: boolean;
	collapsible?: boolean;
}) {
	const [open, setOpen] = React.useState(defaultOpen);
	const meta = toolStateMeta(state);
	const running = isRunning(state);
	const expandable = collapsible && !!children;

	return (
		<div className="border-border-subtle bg-muted/30 my-1.5 rounded-md border">
			<button
				type="button"
				onClick={() => expandable && setOpen((value) => !value)}
				className={[
					"flex w-full items-center gap-2 px-2.5 py-1.5 text-left",
					expandable ? "" : "cursor-default",
				].join(" ")}
			>
				<Icon
					icon={running ? "ph:spinner" : icon}
					className={[
						"size-3.5 shrink-0",
						meta.tone,
						running ? "animate-spin" : "",
					].join(" ")}
				/>
				<span className="min-w-0 flex-1 truncate font-mono text-[11px]">
					{title}
					{subtitle ? (
						<span className="text-muted-foreground"> {subtitle}</span>
					) : null}
				</span>
				{meta.label ? (
					<span className={["shrink-0 text-[10px]", meta.tone].join(" ")}>
						{meta.label}
					</span>
				) : null}
				{expandable ? (
					<Icon
						icon={open ? "ph:caret-up" : "ph:caret-down"}
						className="text-muted-foreground size-3 shrink-0"
					/>
				) : null}
			</button>
			{open && children ? (
				<div className="border-border-subtle space-y-1.5 border-t px-2.5 py-2">
					{children}
				</div>
			) : null}
		</div>
	);
}

function JsonBlock({ value, error }: { value: unknown; error?: boolean }) {
	const text = compactJson(value);
	if (!text) return null;
	return (
		<pre
			className={[
				"bg-muted max-h-40 overflow-auto rounded p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap",
				error ? "text-destructive" : "",
			].join(" ")}
		>
			{text}
		</pre>
	);
}

function outputBlocks(part: PartLike) {
	return part.state === "output-error" ? (
		<JsonBlock value={part.errorText} error />
	) : (
		<JsonBlock value={part.output} />
	);
}

// ── Per-tool cards (claude-code builtins) ─────────────────────

function BashCard({ part }: { part: PartLike }) {
	const input = asRecord(part.input);
	const command = str(input.command);
	return (
		<ToolCard
			icon="ph:terminal-window"
			title="Bash"
			subtitle={str(input.description) || command.slice(0, 60)}
			state={part.state}
		>
			{command ? (
				<pre className="bg-muted max-h-24 overflow-auto rounded p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap">
					$ {command}
				</pre>
			) : null}
			{outputBlocks(part)}
		</ToolCard>
	);
}

function DiffBlock({ oldStr, newStr }: { oldStr: string; newStr: string }) {
	const line = "block px-2 -mx-2 whitespace-pre-wrap";
	return (
		<pre className="bg-muted max-h-56 overflow-auto rounded p-2 font-mono text-[10px] leading-relaxed">
			{oldStr
				? oldStr.split("\n").map((text, index) => (
						<span
							key={`o-${index}`}
							className={`${line} text-destructive bg-destructive/10`}
						>
							- {text}
						</span>
					))
				: null}
			{newStr
				? newStr.split("\n").map((text, index) => (
						<span
							key={`n-${index}`}
							className={`${line} text-success bg-success/10`}
						>
							+ {text}
						</span>
					))
				: null}
		</pre>
	);
}

function FileToolCard({ part }: { part: PartLike }) {
	const key = toolName(part).toLowerCase();
	const input = asRecord(part.input);
	const path = str(input.file_path) || str(input.path) || str(input.notebook_path);
	const pattern = str(input.pattern);
	const icons: Record<string, string> = {
		read: "ph:file-magnifying-glass",
		write: "ph:file-plus",
		edit: "ph:pencil-simple-line",
		notebookedit: "ph:notebook",
		glob: "ph:folders",
		grep: "ph:magnifying-glass",
	};
	const range =
		typeof input.offset === "number" || typeof input.limit === "number"
			? `:${input.offset ?? 0}${input.limit ? `+${input.limit}` : ""}`
			: "";
	const subtitle = path
		? `${path.split("/").slice(-3).join("/")}${range}`
		: pattern;

	return (
		<ToolCard
			icon={icons[key] ?? "ph:file-text"}
			title={prettyToolName(key)}
			subtitle={subtitle}
			state={part.state}
		>
			{key === "edit" ? (
				<DiffBlock
					oldStr={str(input.old_string)}
					newStr={str(input.new_string)}
				/>
			) : key === "write" && str(input.content) ? (
				<pre className="bg-muted max-h-56 overflow-auto rounded p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap">
					{str(input.content)}
				</pre>
			) : (key === "grep" || key === "glob") && pattern ? (
				<div className="font-mono text-[11px]">
					{pattern}
					{path ? (
						<span className="text-muted-foreground"> in {path}</span>
					) : null}
				</div>
			) : (
				<JsonBlock value={part.input} />
			)}
			{outputBlocks(part)}
		</ToolCard>
	);
}

function TodoWriteCard({ part }: { part: PartLike }) {
	const todos = Array.isArray(asRecord(part.input).todos)
		? (asRecord(part.input).todos as Array<Record<string, unknown>>)
		: [];
	return (
		<ToolCard
			icon="ph:list-checks"
			title="Todos"
			subtitle={`${todos.length}`}
			state={part.state}
			defaultOpen={false}
		>
			<div className="space-y-1">
				{todos.map((todo, index) => {
					const status = str(todo.status);
					return (
						<div key={index} className="flex items-start gap-1.5 text-[11px]">
							<Icon
								icon={
									status === "completed"
										? "ph:check-circle-fill"
										: status === "in_progress"
											? "ph:circle-half-fill"
											: "ph:circle"
								}
								className={[
									"mt-0.5 size-3 shrink-0",
									status === "completed"
										? "text-success"
										: status === "in_progress"
											? "text-info"
											: "text-muted-foreground",
								].join(" ")}
							/>
							<span
								className={
									status === "completed"
										? "text-muted-foreground line-through"
										: ""
								}
							>
								{str(todo.content)}
							</span>
						</div>
					);
				})}
			</div>
		</ToolCard>
	);
}

function TaskCard({ part }: { part: PartLike }) {
	const input = asRecord(part.input);
	return (
		<ToolCard
			icon="ph:robot"
			title="Subagent"
			subtitle={str(input.description)}
			state={part.state}
		>
			{str(input.prompt) ? (
				<div className="text-muted-foreground max-h-24 overflow-auto text-[11px] whitespace-pre-wrap">
					{str(input.prompt).slice(0, 600)}
				</div>
			) : null}
			{outputBlocks(part)}
		</ToolCard>
	);
}

function WebCard({ part }: { part: PartLike }) {
	const key = toolName(part).toLowerCase();
	const input = asRecord(part.input);
	const subject = str(input.query) || str(input.url) || str(input.prompt);
	return (
		<ToolCard
			icon={key === "websearch" ? "ph:globe-hemisphere-west" : "ph:globe"}
			title={prettyToolName(key)}
			subtitle={subject.slice(0, 70)}
			state={part.state}
		>
			{outputBlocks(part)}
		</ToolCard>
	);
}

function PlanCard({ part }: { part: PartLike }) {
	const input = asRecord(part.input);
	const plan = str(input.plan) || str(input.prompt);
	return (
		<ToolCard
			icon="ph:clipboard-text"
			title="Plan"
			state={part.state}
			defaultOpen
		>
			{plan ? (
				<Streamdown parseIncompleteMarkdown className="qp-streamdown space-y-2">
					{plan}
				</Streamdown>
			) : (
				<JsonBlock value={part.input} />
			)}
		</ToolCard>
	);
}

function SkillCard({ part }: { part: PartLike }) {
	const input = asRecord(part.input);
	return (
		<ToolCard
			icon="ph:sparkle"
			title="Skill"
			subtitle={str(input.skill)}
			state={part.state}
		>
			{str(input.args) ? (
				<div className="text-muted-foreground font-mono text-[11px]">
					{str(input.args)}
				</div>
			) : null}
			{outputBlocks(part)}
		</ToolCard>
	);
}

// ── AskUserQuestion — the interactive card ────────────────────

interface AskQuestion {
	header?: string;
	question?: string;
	multiSelect?: boolean;
	options?: Array<{ label?: string; description?: string }>;
}

function askQuestions(part: PartLike): AskQuestion[] {
	const input = asRecord(part.input);
	return Array.isArray(input.questions)
		? (input.questions as AskQuestion[])
		: [];
}

function AskUserQuestionCard({
	part,
	onAnswer,
}: {
	part: PartLike;
	onAnswer?: (answer: string) => void;
}) {
	const questions = askQuestions(part);
	const [picked, setPicked] = React.useState<Record<number, Set<string>>>({});
	const [sent, setSent] = React.useState(false);
	const interactive = !!onAnswer && !sent;

	if (questions.length === 0) {
		return (
			<ToolCard
				icon="ph:chat-centered-dots"
				title="AskUserQuestion"
				state={part.state}
			>
				<JsonBlock value={part.input} />
			</ToolCard>
		);
	}

	const toggle = (qi: number, label: string, multi: boolean) => {
		setPicked((current) => {
			const next = { ...current };
			const set = new Set(next[qi] ?? []);
			if (multi) {
				if (set.has(label)) set.delete(label);
				else set.add(label);
			} else {
				set.clear();
				set.add(label);
			}
			next[qi] = set;
			return next;
		});
	};

	const answerText = () =>
		questions
			.map((q, qi) => {
				const chosen = [...(picked[qi] ?? [])];
				if (chosen.length === 0) return null;
				const prefix = q.header || q.question;
				return prefix ? `${prefix}: ${chosen.join(", ")}` : chosen.join(", ");
			})
			.filter(Boolean)
			.join("\n");

	const singleAutoSend = questions.length === 1 && !questions[0]?.multiSelect;
	const canSubmit = questions.some((_, qi) => (picked[qi]?.size ?? 0) > 0);

	return (
		<div className="border-primary/25 bg-primary/5 my-1.5 rounded-md border">
			<div className="flex items-center gap-2 px-2.5 pt-2">
				<Icon icon="ph:chat-centered-dots" className="text-primary size-3.5" />
				<span className="text-primary text-[11px] font-medium">
					Autopilot sa pýta
				</span>
			</div>
			<div className="space-y-2.5 px-2.5 py-2">
				{questions.map((q, qi) => (
					<div key={qi}>
						{q.question ? (
							<div className="mb-1.5 text-sm font-medium">{q.question}</div>
						) : null}
						<div className="flex flex-col gap-1">
							{(q.options ?? []).map((option, oi) => {
								const label = option.label ?? `option-${oi + 1}`;
								const selected = picked[qi]?.has(label) ?? false;
								return (
									<button
										key={oi}
										type="button"
										disabled={!interactive}
										onClick={() => {
											if (!interactive) return;
											if (singleAutoSend) {
												setSent(true);
												onAnswer?.(label);
												return;
											}
											toggle(qi, label, !!q.multiSelect);
										}}
										className={[
											"rounded-md border px-2.5 py-1.5 text-left transition-colors",
											selected
												? "border-primary bg-primary/15"
												: "border-border-subtle bg-card",
											interactive
												? "hover:border-primary/60 cursor-pointer"
												: "cursor-default opacity-80",
										].join(" ")}
									>
										<div className="text-xs font-medium">{label}</div>
										{option.description ? (
											<div className="text-muted-foreground text-[11px]">
												{option.description}
											</div>
										) : null}
									</button>
								);
							})}
						</div>
					</div>
				))}
				{interactive && !singleAutoSend ? (
					<button
						type="button"
						disabled={!canSubmit}
						onClick={() => {
							const text = answerText();
							if (!text) return;
							setSent(true);
							onAnswer?.(text);
						}}
						className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground rounded-md px-2.5 py-1.5 text-xs font-medium"
					>
						Odoslať odpoveď
					</button>
				) : null}
				{!onAnswer ? (
					<div className="text-muted-foreground text-[10px]">
						Odpoveď pošli ako ďalšiu správu.
					</div>
				) : null}
			</div>
		</div>
	);
}

// ── Generic + MCP fallback ────────────────────────────────────

function GenericToolCard({ part }: { part: PartLike }) {
	const rawName = toolName(part);
	const mcp = mcpLabel(rawName);
	return (
		<ToolCard
			icon={mcp ? "ph:plugs-connected" : "ph:wrench"}
			title={mcp ? mcp.tool : rawName}
			subtitle={mcp ? `· ${mcp.server}` : undefined}
			state={part.state}
		>
			<JsonBlock value={part.input} />
			{outputBlocks(part)}
		</ToolCard>
	);
}

/**
 * The registry: claude-code builtins get purpose-built cards. Matched on the
 * LOWERCASE tool name — the `tool-{name}` casing is mixed (sdk keys `bash`/
 * `read`/`edit` are lowercase, `AskUserQuestion`/`TodoWrite`/`Task` are not),
 * so a case-sensitive switch silently dropped the file/shell tools to generic.
 */
function renderToolPart(
	part: PartLike,
	key: string,
	onAnswer?: (answer: string) => void,
): React.ReactNode {
	switch (toolName(part).toLowerCase()) {
		case "askuserquestion":
			return <AskUserQuestionCard key={key} part={part} onAnswer={onAnswer} />;
		case "bash":
		case "bashoutput":
			return <BashCard key={key} part={part} />;
		case "read":
		case "write":
		case "edit":
		case "notebookedit":
		case "glob":
		case "grep":
			return <FileToolCard key={key} part={part} />;
		case "todowrite":
			return <TodoWriteCard key={key} part={part} />;
		case "task":
		case "agent":
			return <TaskCard key={key} part={part} />;
		case "websearch":
		case "webfetch":
			return <WebCard key={key} part={part} />;
		case "exitplanmode":
			return <PlanCard key={key} part={part} />;
		case "skill":
			return <SkillCard key={key} part={part} />;
		default:
			return <GenericToolCard key={key} part={part} />;
	}
}

function ReasoningPart({ part }: { part: PartLike }) {
	const [open, setOpen] = React.useState(false);
	const text = typeof part.text === "string" ? part.text : "";
	if (!text.trim()) return null;

	return (
		<div className="my-1.5">
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-[11px]"
			>
				<Icon icon="ph:brain" className="size-3.5 shrink-0" />
				<span>Reasoning</span>
				<Icon
					icon={open ? "ph:caret-up" : "ph:caret-down"}
					className="size-3 shrink-0"
				/>
			</button>
			{open ? (
				<div className="border-border-subtle text-muted-foreground mt-1 border-l-2 pl-2.5 text-xs leading-relaxed whitespace-pre-wrap">
					{text}
				</div>
			) : null}
		</div>
	);
}

function FilePart({ part }: { part: PartLike }) {
	const label =
		(typeof part.filename === "string" && part.filename) ||
		(typeof part.url === "string" && part.url) ||
		"file";
	return (
		<span className="border-border-subtle bg-card my-1 inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]">
			<Icon icon="ph:paperclip" className="size-3 shrink-0" />
			<span className="truncate">{label}</span>
		</span>
	);
}

function SourcePart({ part }: { part: PartLike }) {
	const title =
		(typeof part.title === "string" && part.title) ||
		(typeof part.url === "string" && part.url) ||
		"source";
	const url = typeof part.url === "string" ? part.url : undefined;
	return (
		<a
			href={url}
			target="_blank"
			rel="noreferrer"
			className="border-border-subtle bg-card text-muted-foreground hover:text-foreground my-1 inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]"
		>
			<Icon icon="ph:link-simple" className="size-3 shrink-0" />
			<span className="truncate">{title}</span>
		</a>
	);
}

// ── Consolidated tool chain (line while live, summary once done) ──

/** One muted line for the CURRENTLY-active tool in a live chain. */
function LiveToolLine({ part }: { part: PartLike }) {
	const running = isRunning(part.state);
	const error = part.state === "output-error";
	const target = toolTarget(part);
	return (
		<div className="text-muted-foreground my-1 flex items-center gap-1.5 text-[11px]">
			<Icon
				icon={
					running ? "ph:spinner" : error ? "ph:warning-circle" : "ph:check"
				}
				className={[
					"size-3 shrink-0",
					running
						? "text-info animate-spin"
						: error
							? "text-destructive"
							: "text-success",
				].join(" ")}
			/>
			<span className="shrink-0 font-medium">{toolDisplayName(part)}</span>
			{target ? (
				<span className="min-w-0 truncate font-mono opacity-80">{target}</span>
			) : null}
		</div>
	);
}

/**
 * A finished chain of activity tools collapses to one line of consolidated
 * names (`Read · Edit ×2 · Bash`), expandable to the full per-tool cards.
 */
function ConsolidatedToolGroup({
	parts,
	groupKey,
	onAnswer,
}: {
	parts: PartLike[];
	groupKey: string;
	onAnswer?: (answer: string) => void;
}) {
	const [open, setOpen] = React.useState(false);
	const counts = new Map<string, number>();
	const order: string[] = [];
	for (const part of parts) {
		const name = toolDisplayName(part);
		if (!counts.has(name)) order.push(name);
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	const label = order
		.map((name) => (counts.get(name)! > 1 ? `${name} ×${counts.get(name)}` : name))
		.join(" · ");
	const anyError = parts.some((part) => part.state === "output-error");
	const anyRunning = parts.some((part) => isRunning(part.state));

	return (
		<div className="my-1">
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 text-[11px]"
			>
				<Icon
					icon={
						anyRunning
							? "ph:spinner"
							: anyError
								? "ph:warning-circle"
								: "ph:wrench"
					}
					className={[
						"size-3 shrink-0",
						anyRunning
							? "text-info animate-spin"
							: anyError
								? "text-destructive"
								: "",
					].join(" ")}
				/>
				<span className="min-w-0 flex-1 truncate text-left">{label}</span>
				<span className="shrink-0 opacity-60">{parts.length}</span>
				<Icon
					icon={open ? "ph:caret-up" : "ph:caret-down"}
					className="size-3 shrink-0"
				/>
			</button>
			{open ? (
				<div className="mt-1 space-y-1">
					{parts.map((part, index) =>
						renderToolPart(part, `${groupKey}-${index}`, onAnswer),
					)}
				</div>
			) : null}
		</div>
	);
}

/** Non-activity parts render standalone (text, reasoning, question, plan…). */
function renderStandalonePart(
	part: PartLike,
	key: string,
	onAnswer?: (answer: string) => void,
): React.ReactNode {
	if (part.type === "text" && typeof part.text === "string") {
		return part.text ? (
			<Streamdown
				key={key}
				parseIncompleteMarkdown
				className="qp-streamdown space-y-2"
			>
				{part.text}
			</Streamdown>
		) : null;
	}
	if (part.type === "reasoning") return <ReasoningPart key={key} part={part} />;
	// Breaker tools (AskUserQuestion / ExitPlanMode) keep their full card.
	if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
		return renderToolPart(part, key, onAnswer);
	}
	if (part.type === "file") return <FilePart key={key} part={part} />;
	if (part.type === "source-url" || part.type === "source-document") {
		return <SourcePart key={key} part={part} />;
	}
	// step-start, data-*, unknown → nothing.
	return null;
}

type PartSegment =
	| { kind: "standalone"; part: PartLike; index: number }
	| { kind: "tools"; parts: PartLike[]; start: number };

function segmentParts(parts: PartLike[]): PartSegment[] {
	const segments: PartSegment[] = [];
	let run: { parts: PartLike[]; start: number } | null = null;
	const flush = () => {
		if (run) {
			segments.push({ kind: "tools", parts: run.parts, start: run.start });
			run = null;
		}
	};
	parts.forEach((part, index) => {
		if (isActivityTool(part)) {
			if (!run) run = { parts: [], start: index };
			run.parts.push(part);
		} else {
			flush();
			segments.push({ kind: "standalone", part, index });
		}
	});
	flush();
	return segments;
}

/**
 * Renders assistant message parts in order. `degraded` forces plain-text
 * rendering (§4.2 cutover safety switch). `onAnswer` makes AskUserQuestion
 * interactive. `live` = this message is the one currently streaming — the
 * trailing tool chain then shows only the CURRENT tool as a live line;
 * every finished chain collapses to a consolidated, expandable summary.
 */
export function MessageParts({
	message,
	degraded = false,
	onAnswer,
	live = false,
}: {
	message: UIMessageLike;
	degraded?: boolean;
	onAnswer?: (answer: string) => void;
	live?: boolean;
}) {
	const parts = partsOf(message);

	if (degraded) {
		const text = messageText(message);
		return text ? (
			<div className="text-sm leading-relaxed break-words whitespace-pre-wrap">
				{text}
			</div>
		) : null;
	}

	const segments = segmentParts(parts);

	return (
		<div className="text-sm leading-relaxed break-words">
			{segments.map((segment, segmentIndex) => {
				if (segment.kind === "standalone") {
					return renderStandalonePart(
						segment.part,
						`${message.id}-${segment.index}`,
						onAnswer,
					);
				}
				const key = `${message.id}-tools-${segment.start}`;
				const isTrailing = segmentIndex === segments.length - 1;
				// Live + trailing chain → only the current (last) tool as a line.
				if (isTrailing && live) {
					return (
						<LiveToolLine
							key={key}
							part={segment.parts[segment.parts.length - 1]}
						/>
					);
				}
				return (
					<ConsolidatedToolGroup
						key={key}
						groupKey={key}
						parts={segment.parts}
						onAnswer={onAnswer}
					/>
				);
			})}
		</div>
	);
}
