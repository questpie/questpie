/**
 * MessageParts — renders a UIMessage's `parts` array (§4.2).
 *
 * Shared by the work-rail chat, the mobile chat page, and the run-detail
 * transcript (T10). Text parts render through Streamdown (streaming-safe
 * markdown); tool/reasoning parts render as collapsible cards; unknown part
 * types render nothing (degraded mode: a broken part never blanks the bubble).
 */

import { Icon } from "@iconify/react";
import * as React from "react";
import { Streamdown } from "streamdown";

type UIMessageLike = {
	id: string;
	role: string;
	parts?: unknown;
	metadata?: Record<string, unknown>;
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

function compactJson(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function ToolPartCard({ part }: { part: PartLike }) {
	const [open, setOpen] = React.useState(false);
	const meta = toolStateMeta(part.state);
	const input = compactJson(part.input);
	const output =
		part.state === "output-error"
			? compactJson(part.errorText)
			: compactJson(part.output);
	const running = part.state === "input-streaming" || part.state === "input-available";

	return (
		<div className="border-border-subtle bg-muted/30 my-1.5 rounded-md border">
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
			>
				<Icon
					icon={running ? "ph:spinner" : "ph:wrench"}
					className={[
						"size-3.5 shrink-0",
						meta.tone,
						running ? "animate-spin" : "",
					].join(" ")}
				/>
				<span className="min-w-0 flex-1 truncate font-mono text-[11px]">
					{toolName(part)}
				</span>
				{meta.label ? (
					<span className={["shrink-0 text-[10px]", meta.tone].join(" ")}>
						{meta.label}
					</span>
				) : null}
				<Icon
					icon={open ? "ph:caret-up" : "ph:caret-down"}
					className="text-muted-foreground size-3 shrink-0"
				/>
			</button>
			{open ? (
				<div className="border-border-subtle space-y-1.5 border-t px-2.5 py-2">
					{input ? (
						<pre className="bg-muted max-h-40 overflow-auto rounded p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap">
							{input}
						</pre>
					) : null}
					{output ? (
						<pre
							className={[
								"bg-muted max-h-40 overflow-auto rounded p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap",
								part.state === "output-error" ? "text-destructive" : "",
							].join(" ")}
						>
							{output}
						</pre>
					) : null}
				</div>
			) : null}
		</div>
	);
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

/**
 * Renders assistant message parts in order. `degraded` forces plain-text
 * rendering of the accumulated text parts only (§4.2 cutover safety switch).
 */
export function MessageParts({
	message,
	degraded = false,
}: {
	message: UIMessageLike;
	degraded?: boolean;
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

	return (
		<div className="text-sm leading-relaxed break-words">
			{parts.map((part, index) => {
				const key = `${message.id}-${index}`;
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
				if (part.type === "reasoning") {
					return <ReasoningPart key={key} part={part} />;
				}
				if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
					return <ToolPartCard key={key} part={part} />;
				}
				if (part.type === "file") {
					return <FilePart key={key} part={part} />;
				}
				if (part.type === "source-url" || part.type === "source-document") {
					return <SourcePart key={key} part={part} />;
				}
				if (part.type === "step-start") {
					return null;
				}
				// data-* and unknown parts render nothing (degraded tolerance).
				return null;
			})}
		</div>
	);
}
