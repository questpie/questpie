import { Icon } from "@iconify/react";
import { useMemo, useState } from "react";

type ToolState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

export interface ToolCallCardProps {
  toolName: string;
  toolCallId: string;
  state: ToolState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  title?: string;
  approval?: { id: string; approved?: boolean; reason?: string };
}

export function ToolCallCard({
  toolName,
  state,
  input,
  output,
  errorText,
  title,
  approval,
}: ToolCallCardProps) {
  const isRunning = state === "input-streaming" || state === "input-available";
  const hasOutput = state === "output-available" || state === "output-error";

  return (
    <div className="rounded-lg border border-[var(--border)] overflow-hidden my-2">
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--muted)]">
        <Icon icon="ph:wrench" width={14} height={14} className="text-[var(--muted-foreground)]" />
        <span className="font-mono text-xs font-medium flex-1 truncate">
          {title || toolName}
        </span>
        <StateBadge state={state} approval={approval} />
      </div>

      <CollapsibleSection
        label="Input"
        defaultOpen={!hasOutput}
      >
        <JsonView value={input} isStreaming={state === "input-streaming"} />
      </CollapsibleSection>

      {state === "output-error" && errorText && (
        <div className="px-3 py-2 text-xs text-[var(--destructive)] border-t border-[var(--border)]">
          {errorText}
        </div>
      )}

      {state === "output-available" && output !== undefined && (
        <CollapsibleSection label="Output" defaultOpen>
          <JsonView value={output} />
        </CollapsibleSection>
      )}

      {state === "output-denied" && approval?.reason && (
        <div className="px-3 py-2 text-xs text-[var(--muted-foreground)] border-t border-[var(--border)] italic">
          Reason: {approval.reason}
        </div>
      )}
    </div>
  );
}

// --- State Badge ---

function StateBadge({
  state,
  approval,
}: {
  state: ToolState;
  approval?: { approved?: boolean };
}) {
  switch (state) {
    case "input-streaming":
      return (
        <span className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
          <Icon icon="ph:circle-notch" width={12} height={12} className="animate-spin" />
          Calling...
        </span>
      );
    case "input-available":
      return (
        <span className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
          <Icon icon="ph:circle-notch" width={12} height={12} className="animate-spin" />
          Running...
        </span>
      );
    case "approval-requested":
      return (
        <span className="flex items-center gap-1 text-[11px] text-[var(--warning)]">
          <Icon icon="ph:warning" width={12} height={12} />
          Needs approval
        </span>
      );
    case "approval-responded":
      if (approval?.approved) {
        return (
          <span className="flex items-center gap-1 text-[11px] text-[var(--success)]">
            <Icon icon="ph:check-circle" width={12} height={12} />
            Approved
          </span>
        );
      }
      return (
        <span className="flex items-center gap-1 text-[11px] text-[var(--destructive)]">
          <Icon icon="ph:prohibit" width={12} height={12} />
          Denied
        </span>
      );
    case "output-available":
      return (
        <span className="flex items-center gap-1 text-[11px] text-[var(--success)]">
          <Icon icon="ph:check-circle" width={12} height={12} />
          Done
        </span>
      );
    case "output-error":
      return (
        <span className="flex items-center gap-1 text-[11px] text-[var(--destructive)]">
          <Icon icon="ph:x-circle" width={12} height={12} />
          Error
        </span>
      );
    case "output-denied":
      return (
        <span className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
          <Icon icon="ph:prohibit" width={12} height={12} />
          Denied
        </span>
      );
  }
}

// --- Collapsible Section ---

function CollapsibleSection({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-[var(--border)]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 w-full px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
        aria-expanded={open}
      >
        <Icon
          icon={open ? "ph:caret-down" : "ph:caret-right"}
          width={12}
          height={12}
        />
        {label}
      </button>
      {open && <div className="px-3 py-2">{children}</div>}
    </div>
  );
}

// --- JSON Viewer ---

const MAX_LINES = 20;
const MAX_CHARS = 5000;

function JsonView({ value, isStreaming }: { value: unknown; isStreaming?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const formatted = useMemo(() => {
    if (value === undefined || value === null) {
      return isStreaming ? "..." : "null";
    }
    try {
      const str = JSON.stringify(value, null, 2);
      return str;
    } catch {
      return String(value);
    }
  }, [value, isStreaming]);

  const isTruncated = !expanded && (
    formatted.split("\n").length > MAX_LINES || formatted.length > MAX_CHARS
  );

  const displayText = isTruncated
    ? formatted.split("\n").slice(0, MAX_LINES).join("\n").slice(0, MAX_CHARS)
    : formatted;

  return (
    <div>
      <pre className="text-xs font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap break-all text-[var(--muted-foreground)]">
        {displayText}
        {isTruncated && "..."}
      </pre>
      {isTruncated && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-[11px] text-[var(--primary)] hover:underline mt-1"
        >
          Show more
        </button>
      )}
      {isStreaming && (
        <span className="inline-block ml-1 w-1.5 h-3.5 bg-[var(--muted-foreground)] animate-pulse rounded-sm" />
      )}
    </div>
  );
}
