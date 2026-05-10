import {
  useCollectionList,
  useCollectionUpdate,
  selectClient,
  useAdminStore,
} from "@questpie/admin/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { ModelMessage, UIMessage } from "ai";

export type AiMessageRole = ModelMessage["role"];

export interface AiMessage {
  id: string;
  session: string;
  role: AiMessageRole;
  content: ModelMessage["content"];
  parts?: UIMessage["parts"];
  run?: string;
  model?: string;
  provider?: string;
  createdAt: string;
}

export interface UseAiChatOptions {
  sessionId?: string;
}

export function useAiChat(options: UseAiChatOptions = {}) {
  const { sessionId } = options;
  const client = useAdminStore(selectClient);
  const queryClient = useQueryClient();
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(
    sessionId,
  );
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const cancelRunMutation = useCollectionUpdate("ai_runs");

  const messagesQuery = useCollectionList(
    "ai_messages",
    {
      where: { session: activeSessionId },
      orderBy: { createdAt: "asc" },
      limit: 200,
    },
    { enabled: !!activeSessionId },
    { realtime: true },
  );

  const sendMutation = useMutation({
    mutationFn: async (input: {
      content: string;
      model?: string;
      attachments?: unknown[];
    }) => {
      return (client.routes as any).chat.post({
        sessionId: activeSessionId,
        content: input.content,
        model: input.model,
        attachments: input.attachments,
      });
    },
    onSuccess: (data: any) => {
      if (data.sessionId) setActiveSessionId(data.sessionId);
      if (data.runId) setActiveRunId(data.runId);
      queryClient.invalidateQueries({ queryKey: ["questpie", "collections"] });
    },
  });

  const sendMessage = useCallback(
    (content: string, opts?: { model?: string; attachments?: unknown[] }) => {
      return sendMutation.mutateAsync({ content, ...opts });
    },
    [sendMutation],
  );

  const stopGeneration = useCallback(() => {
    if (!activeRunId) return;
    cancelRunMutation.mutate({
      id: activeRunId,
      data: { status: "cancelled" },
    });
    setActiveRunId(null);
  }, [activeRunId, cancelRunMutation]);

  const clearActiveRun = useCallback(() => {
    setActiveRunId(null);
  }, []);

  return {
    session: activeSessionId ?? null,
    messages: (messagesQuery.data?.docs ?? []) as AiMessage[],
    isLoading: messagesQuery.isLoading || sendMutation.isPending,
    isSending: sendMutation.isPending,
    activeRunId,
    sendMessage,
    stopGeneration,
    clearActiveRun,
    setActiveSessionId,
  };
}
