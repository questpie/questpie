import {
  useCollectionList,
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
      queryClient.invalidateQueries({ queryKey: ["questpie", "collections"] });
    },
  });

  const sendMessage = useCallback(
    (content: string, opts?: { model?: string; attachments?: unknown[] }) => {
      return sendMutation.mutateAsync({ content, ...opts });
    },
    [sendMutation],
  );

  return {
    session: activeSessionId ?? null,
    messages: (messagesQuery.data?.docs ?? []) as AiMessage[],
    isLoading: messagesQuery.isLoading || sendMutation.isPending,
    sendMessage,
    setActiveSessionId,
  };
}
