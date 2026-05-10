import { Icon } from "@iconify/react";
import { useState } from "react";

export interface MessageActionsProps {
  content: string;
  onRetry?: () => void;
  showRetry?: boolean;
}

export function MessageActions({ content, onRetry, showRetry }: MessageActionsProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex items-center gap-0.5 opacity-0 group-hover/message:opacity-100 transition-opacity">
      <button
        type="button"
        onClick={handleCopy}
        className="flex items-center justify-center w-7 h-7 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
        title={copied ? "Copied!" : "Copy message"}
      >
        <Icon
          icon={copied ? "ph:check" : "ph:copy"}
          width={14}
          height={14}
        />
      </button>
      {showRetry && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center justify-center w-7 h-7 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          title="Retry"
        >
          <Icon icon="ph:arrow-counter-clockwise" width={14} height={14} />
        </button>
      )}
    </div>
  );
}
