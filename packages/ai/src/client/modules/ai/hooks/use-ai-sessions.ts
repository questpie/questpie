import {
  useCollectionCreate,
  useCollectionList,
  useCollectionUpdate,
} from "@questpie/admin/client";
import { useCallback, useState } from "react";

export interface AiSession {
  id: string;
  title?: string;
  status: "active" | "closed" | "archived";
  scopeType?: string;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
}

export function useAiSessions() {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const sessionsQuery = useCollectionList(
    "ai_sessions",
    {
      where: { status: "active" },
      orderBy: { updatedAt: "desc" },
      limit: 50,
    },
    undefined,
    { realtime: true },
  );

  const createMutation = useCollectionCreate("ai_sessions");
  const updateMutation = useCollectionUpdate("ai_sessions");

  const createSession = useCallback(
    async (title?: string) => {
      const session = await createMutation.mutateAsync({
        title,
        status: "active",
      });
      setActiveSessionId(session.id);
      return session as AiSession;
    },
    [createMutation],
  );

  const closeSession = useCallback(
    (id: string) =>
      updateMutation.mutateAsync({ id, data: { status: "closed" } }),
    [updateMutation],
  );

  return {
    sessions: (sessionsQuery.data?.docs ?? []) as AiSession[],
    activeSession:
      (sessionsQuery.data?.docs ?? []).find(
        (s: any) => s.id === activeSessionId,
      ) ?? null,
    setActiveSession: setActiveSessionId,
    createSession,
    closeSession,
    isLoading: sessionsQuery.isLoading,
  };
}
