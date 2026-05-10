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

function getStatusIcon(
  state: ToolState,
  approved?: boolean,
): { icon: string; className: string } {
  switch (state) {
    case "input-streaming":
    case "input-available":
      return { icon: "ph:circle-notch", className: "animate-spin text-[var(--muted-foreground)]" };
    case "approval-requested":
      return { icon: "ph:hand-palm", className: "text-[var(--warning)]" };
    case "approval-responded":
      return approved
        ? { icon: "ph:check-circle", className: "text-[var(--success)]" }
        : { icon: "ph:prohibit", className: "text-[var(--destructive)]" };
    case "output-available":
      return { icon: "ph:check-circle", className: "text-[var(--muted-foreground)] opacity-60" };
    case "output-error":
      return { icon: "ph:x-circle", className: "text-[var(--destructive)]" };
    case "output-denied":
      return { icon: "ph:prohibit", className: "text-[var(--muted-foreground)]" };
  }
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
  const [expanded, setExpanded] = useState(false);
  const hasDetails =
    input !== undefined || output !== undefined || errorText || approval?.reason;

  const statusIcon = getStatusIcon(state, approval?.approved);

  return (
    <div>
      <button
        type="button"
        onClick={() => hasDetails && setExpanded((v) => !v)}
        className={`flex items-center gap-2 py-0.5 w-full text-left text-xs text-[var(--muted-foreground)] ${hasDetails ? "hover:text-[var(--foreground)] cursor-pointer" : "cursor-default"} transition-colors`}
      >
        <Icon icon="ph:wrench" width={10} height={10} className="shrink-0" />
        <span className="truncate flex-1">{title || toolName}</span>
        <Icon
          icon={statusIcon.icon}
          width={10}
          height={10}
          className={`shrink-0 ${statusIcon.className}`}
        />
      </button>
      {expanded && hasDetails && (
        <div className="pl-[18px] pb-1">
          {input !== undefined && (
            <CompactJson label="input" value={input} />
          )}
          {output !== undefined && (
            <CompactJson label="output" value={output} />
          )}
          {errorText && (
            <p className="text-[11px] text-[var(--destructive)]">{errorText}</p>
          )}
          {approval?.reason && (
            <p className="text-[11px] text-[var(--muted-foreground)] italic">
              {approval.reason}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CompactJson({ label, value }: { label: string; value: unknown }) {
  const text = useMemo(() => {
    if (value === undefined || value === null) return "null";
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);

  const lines = text.split("\n");
  const truncated = lines.length > 8;
  const [showFull, setShowFull] = useState(false);
  const display = showFull ? text : lines.slice(0, 8).join("\n");

  return (
    <div className="mt-0.5">
      <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] opacity-60">
        {label}
      </span>
      <pre className="text-[11px] font-mono leading-snug text-[var(--muted-foreground)] whitespace-pre-wrap break-all">
        {display}
        {truncated && !showFull && "..."}
      </pre>
      {truncated && !showFull && (
        <button
          type="button"
          onClick={() => setShowFull(true)}
          className="text-[10px] text-[var(--primary)] hover:underline"
        >
          show all
        </button>
      )}
    </div>
  );
}
