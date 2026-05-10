import { Icon } from "@iconify/react";
import { useAiChat } from "../hooks/use-ai-chat.js";
import { useAiSessions, type AiSession } from "../hooks/use-ai-sessions.js";
import { AiComposer, type Attachment } from "./ai-composer.js";
import { AiMessageBubble } from "./ai-message-bubble.js";
import { AutoScrollContainer } from "./auto-scroll-container.js";
import { MessageActions } from "./message-actions.js";

export interface AiChatRailProps {
  defaultOpen?: boolean;
  position?: "left" | "right";
}

export function AiChatRail(_props: AiChatRailProps) {
  const sessions = useAiSessions();
  const chat = useAiChat({
    sessionId: sessions.activeSession?.id ?? undefined,
  });

  return (
    <div className="flex flex-col h-full bg-[var(--background)]">
      <SessionBar
        sessions={sessions.sessions}
        activeSession={sessions.activeSession}
        onSelectSession={sessions.setActiveSession}
        onCreateSession={() => sessions.createSession()}
        isLoading={sessions.isLoading}
      />

      <AutoScrollContainer
        className="flex-1"
        dependencies={[chat.messages]}
      >
        <MessageList
          messages={chat.messages}
          isLoading={chat.isLoading && chat.messages.length === 0}
          hasSession={!!sessions.activeSession}
        />
      </AutoScrollContainer>

      <AiComposer
        onSend={(content, opts) => chat.sendMessage(content, opts)}
        isLoading={chat.isLoading}
        selectedModel={null}
        disabled={!sessions.activeSession}
        placeholder={
          sessions.activeSession
            ? "Type a message..."
            : "Create a session to start chatting"
        }
      />
    </div>
  );
}

// --- Session Bar ---

function SessionBar({
  sessions,
  activeSession,
  onSelectSession,
  onCreateSession,
  isLoading,
}: {
  sessions: AiSession[];
  activeSession: AiSession | null;
  onSelectSession: (id: string | null) => void;
  onCreateSession: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--border)] bg-[var(--card)] overflow-x-auto shrink-0">
      {isLoading && sessions.length === 0 ? (
        <span className="text-xs text-[var(--muted-foreground)]">Loading...</span>
      ) : (
        sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            onClick={() => onSelectSession(session.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs whitespace-nowrap transition-colors ${
              session.id === activeSession?.id
                ? "bg-[var(--muted)] text-[var(--foreground)] font-medium"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                session.status === "active"
                  ? "bg-[var(--success)]"
                  : "bg-[var(--muted-foreground)]"
              }`}
            />
            <span className="truncate max-w-[120px]">
              {session.title || "New chat"}
            </span>
          </button>
        ))
      )}
      <button
        type="button"
        onClick={onCreateSession}
        className="flex items-center justify-center w-6 h-6 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors shrink-0 ml-1"
        title="New session"
      >
        <Icon icon="ph:plus" width={14} height={14} />
      </button>
    </div>
  );
}

// --- Message List ---

function MessageList({
  messages,
  isLoading,
  hasSession,
}: {
  messages: ReturnType<typeof useAiChat>["messages"];
  isLoading: boolean;
  hasSession: boolean;
}) {
  if (!hasSession) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--muted-foreground)] gap-2 p-8">
        <Icon icon="ph:chat-circle-dots" width={40} height={40} className="opacity-40" />
        <p className="text-sm">Select or create a session to start</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Icon icon="ph:circle-notch" width={24} height={24} className="animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--muted-foreground)] gap-2 p-8">
        <Icon icon="ph:sparkle" width={40} height={40} className="opacity-40" />
        <p className="text-sm">Send a message to get started</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {messages.map((msg, i) => {
        const isLastAssistant =
          msg.role === "assistant" &&
          i === messages.length - 1;
        const textContent = extractTextContent(msg);

        return (
          <div key={msg.id} className="group/message relative">
            <AiMessageBubble
              message={msg}
              isLastAssistant={isLastAssistant}
            />
            {msg.role === "assistant" && textContent && (
              <div className="mt-1 ml-1">
                <MessageActions
                  content={textContent}
                  showRetry={isLastAssistant}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function extractTextContent(message: { parts?: unknown[]; content: unknown }): string {
  if (message.parts && Array.isArray(message.parts)) {
    return message.parts
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("\n");
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  return "";
}
