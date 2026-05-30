import { useCollectionItem, useCollectionList } from "@questpie/admin/client";
import { useMemo } from "react";

export interface RunEvent {
  id: string;
  type: string;
  level: string;
  summary?: string;
  sequence?: number;
  meta?: Record<string, unknown>;
  createdAt: string;
}

export interface ToolCallState {
  tool: string;
  status: "running" | "completed" | "error";
  output?: unknown;
}

export interface UseRunStreamOptions {
  runId: string | null;
}

export function useRunStream(options: UseRunStreamOptions) {
  const { runId } = options;

  const runQuery = useCollectionItem("ai_runs", runId ?? "", undefined, {
    enabled: !!runId,
  });

  const eventsQuery = useCollectionList(
    "ai_run_events",
    {
      where: { run: runId },
      orderBy: { createdAt: "asc" },
      limit: 500,
    },
    { enabled: !!runId },
    { realtime: true },
  );

  const events = useMemo(
    () => (eventsQuery.data?.docs ?? []) as RunEvent[],
    [eventsQuery.data?.docs],
  );
  const status = (runQuery.data as any)?.status ?? "pending";

  const { text, tools } = useMemo(() => {
    let accText = "";
    const toolMap = new Map<string, ToolCallState>();
    for (const event of events) {
      const meta = event.meta;
      if (!meta) continue;
      if (meta.type === "text.delta" && typeof meta.text === "string") {
        accText += meta.text;
      } else if (meta.type === "tool.started") {
        const key = (meta.commandId as string) ?? (meta.tool as string);
        toolMap.set(key, { tool: meta.tool as string, status: "running" });
      } else if (meta.type === "tool.completed") {
        const key = (meta.commandId as string) ?? (meta.tool as string);
        const existing = toolMap.get(key);
        if (existing) {
          existing.status = "completed";
          existing.output = meta.output;
        }
      }
    }
    return { text: accText, tools: [...toolMap.values()] };
  }, [events]);

  const isStreaming =
    status === "pending" || status === "claimed" || status === "running";

  return { events, status, isStreaming, text, tools };
}
