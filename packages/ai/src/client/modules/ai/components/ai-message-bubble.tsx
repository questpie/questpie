import { Icon } from "@iconify/react";
import type { AiMessage } from "../hooks/use-ai-chat.js";
import { MarkdownRenderer } from "./markdown-renderer.js";
import { ReasoningSection } from "./reasoning-section.js";
import { SourceCitation } from "./source-citation.js";
import { StreamingCursor } from "./streaming-cursor.js";
import { ToolCallCard } from "./tool-call-card.js";

export interface AiMessageBubbleProps {
  message: AiMessage;
  isLastAssistant?: boolean;
}

export function AiMessageBubble({ message }: AiMessageBubbleProps) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
      data-ai-message
      data-role={message.role}
    >
      <div
        className={`${isUser ? "max-w-[85%]" : "max-w-[92%]"} ${getBubbleStyle(message.role)}`}
      >
        <PartsRenderer message={message} />
        {isAssistant && message.model && (
          <div className="mt-1.5 text-[11px] text-[var(--muted-foreground)] opacity-60">
            {message.model}
          </div>
        )}
      </div>
    </div>
  );
}

function getBubbleStyle(role: AiMessage["role"]): string {
  switch (role) {
    case "user":
      return "bg-[var(--primary)] text-[var(--primary-foreground)] rounded-2xl rounded-br-sm px-4 py-2.5";
    case "assistant":
      return "bg-[var(--card)] rounded-2xl rounded-bl-sm px-4 py-3 border border-[var(--border)]";
    case "system":
      return "bg-[var(--muted)] rounded-lg px-3 py-2 text-[var(--muted-foreground)] text-xs text-center w-full";
    default:
      return "bg-[var(--card)] rounded-2xl rounded-bl-sm px-4 py-3 border border-[var(--border)]";
  }
}

function PartsRenderer({ message }: { message: AiMessage }) {
  const parts = message.parts;

  if (parts && parts.length > 0) {
    return (
      <>
        {parts.map((part, i) => (
          <PartRenderer key={i} part={part} />
        ))}
      </>
    );
  }

  // Fallback: render content directly
  if (typeof message.content === "string") {
    return <MarkdownRenderer content={message.content} />;
  }

  return (
    <pre className="text-xs font-mono whitespace-pre-wrap">
      {JSON.stringify(message.content, null, 2)}
    </pre>
  );
}

function PartRenderer({ part }: { part: any }) {
  switch (part.type) {
    case "text":
      return (
        <div>
          <MarkdownRenderer
            content={part.text}
            isStreaming={part.state === "streaming"}
          />
          <StreamingCursor isStreaming={part.state === "streaming"} />
        </div>
      );

    case "reasoning":
      return <ReasoningSection text={part.text} state={part.state} />;

    case "file":
      return <FilePart mediaType={part.mediaType} url={part.url} filename={part.filename} />;

    case "source-url":
      return (
        <SourceCitation
          type="source-url"
          sourceId={part.sourceId}
          url={part.url}
          title={part.title}
        />
      );

    case "source-document":
      return (
        <SourceCitation
          type="source-document"
          sourceId={part.sourceId}
          mediaType={part.mediaType}
          title={part.title}
          filename={part.filename}
        />
      );

    case "step-start":
      return (
        <div className="my-2 border-t border-[var(--border)] opacity-40" />
      );

    case "dynamic-tool":
      return (
        <ToolCallCard
          toolName={part.toolName}
          toolCallId={part.toolCallId}
          state={part.state}
          input={part.input}
          output={part.output}
          errorText={part.errorText}
          title={part.title}
          approval={part.approval}
        />
      );

    default:
      // Handle typed tool parts (type: "tool-{name}")
      if (typeof part.type === "string" && part.type.startsWith("tool-")) {
        return (
          <ToolCallCard
            toolName={part.toolName ?? part.type.slice(5)}
            toolCallId={part.toolCallId}
            state={part.state}
            input={part.input}
            output={part.output}
            errorText={part.errorText}
            title={part.title}
            approval={part.approval}
          />
        );
      }
      return null;
  }
}

function FilePart({
  mediaType,
  url,
  filename,
}: {
  mediaType: string;
  url?: string;
  filename?: string;
}) {
  if (!url) return null;

  if (mediaType.startsWith("image/")) {
    return (
      <img
        src={url}
        alt={filename || "Attached image"}
        className="max-h-64 rounded-lg my-1 border border-[var(--border)]"
      />
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--muted)] border border-[var(--border)] text-xs text-[var(--foreground)] hover:bg-[var(--border)] transition-colors my-1"
    >
      <Icon icon="ph:file-arrow-down" width={14} height={14} />
      <span className="truncate max-w-[200px]">{filename || "Download file"}</span>
    </a>
  );
}
