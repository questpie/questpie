import { Icon } from "@iconify/react";
import { useState } from "react";

export interface ReasoningSectionProps {
  text: string;
  state?: "streaming" | "done";
}

export function ReasoningSection({ text, state }: ReasoningSectionProps) {
  const [open, setOpen] = useState(false);
  const isStreaming = state === "streaming";

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors py-1"
        aria-expanded={open}
      >
        <Icon
          icon={open ? "ph:caret-down" : "ph:caret-right"}
          width={12}
          height={12}
        />
        <Icon icon="ph:brain" width={14} height={14} />
        <span>Thinking</span>
        {isStreaming && (
          <span className="flex gap-0.5 ml-1">
            <span className="w-1 h-1 rounded-full bg-[var(--muted-foreground)] animate-pulse" />
            <span className="w-1 h-1 rounded-full bg-[var(--muted-foreground)] animate-pulse [animation-delay:150ms]" />
            <span className="w-1 h-1 rounded-full bg-[var(--muted-foreground)] animate-pulse [animation-delay:300ms]" />
          </span>
        )}
      </button>
      {open && (
        <div className="pl-5 pb-2 text-xs text-[var(--muted-foreground)] whitespace-pre-wrap leading-relaxed">
          {text}
          {isStreaming && (
            <span className="inline-block w-1.5 h-3 bg-[var(--muted-foreground)] animate-pulse rounded-sm ml-0.5 align-middle" />
          )}
        </div>
      )}
    </div>
  );
}
