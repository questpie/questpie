import { Icon } from "@iconify/react";
import { useState } from "react";

export interface ReasoningSectionProps {
  text: string;
  state?: "streaming" | "done";
}

export function ReasoningSection({ text, state }: ReasoningSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const isStreaming = state === "streaming";

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 py-0.5 w-full text-left text-xs text-[var(--muted-foreground)] italic hover:text-[var(--foreground)] transition-colors"
      >
        <Icon
          icon={isStreaming ? "ph:circle-notch" : "ph:brain"}
          width={10}
          height={10}
          className={`shrink-0 ${isStreaming ? "animate-spin" : ""}`}
        />
        <span className="truncate">{isStreaming ? "Thinking…" : "Thought"}</span>
      </button>
      {expanded && (
        <div className="pl-[18px] pb-1 text-[11px] text-[var(--muted-foreground)] whitespace-pre-wrap leading-relaxed">
          {text}
          {isStreaming && (
            <span className="inline-block w-1 h-3 bg-[var(--muted-foreground)] animate-pulse rounded-sm ml-0.5 align-text-bottom" />
          )}
        </div>
      )}
    </div>
  );
}
