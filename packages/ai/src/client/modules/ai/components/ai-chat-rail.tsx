import { Icon } from "@iconify/react";
import { useAiChat, type AiMessage } from "../hooks/use-ai-chat.js";
import { useAiSessions, type AiSession } from "../hooks/use-ai-sessions.js";
import { useRunStream } from "../hooks/use-run-stream.js";
import { useAiProviders } from "../hooks/use-ai-providers.js";
import { AiComposer } from "./ai-composer.js";
import { AiMessageBubble } from "./ai-message-bubble.js";
import { AutoScrollContainer } from "./auto-scroll-container.js";
import { MessageActions } from "./message-actions.js";
import { MarkdownRenderer } from "./markdown-renderer.js";
import { StreamingCursor } from "./streaming-cursor.js";
import { ToolCallCard } from "./tool-call-card.js";

export interface AiChatRailProps {
  defaultOpen?: boolean;
  position?: "left" | "right";
}

export function AiChatRail(_props: AiChatRailProps) {
  const sessions = useAiSessions();
  const chat = useAiChat({
    sessionId: sessions.activeSession?.id ?? undefined,
  });
  const runStream = useRunStream({ runId: chat.activeRunId });
  const providers = useAiProviders();

  const isStreaming = runStream.isStreaming;

  return (
    <div className="flex flex-col h-full bg-[var(--background)]">
      {/* Session bar */}
      <SessionBar
        sessions={sessions.sessions}
        activeSession={sessions.activeSession}
        onSelectSession={sessions.setActiveSession}
        onCreateSession={() => sessions.createSession()}
        onCloseSession={sessions.closeSession}
        isLoading={sessions.isLoading}
      />

      {/* Messages */}
      <AutoScrollContainer
        className="flex-1"
        dependencies={[chat.messages, runStream.text, runStream.tools]}
      >
        <MessageList
          messages={chat.messages}
          isLoading={chat.isLoading && chat.messages.length === 0}
          hasSession={!!sessions.activeSession}
        />

        {/* Live streaming bubble */}
        {isStreaming && (
          <div className="px-4 pb-3">
            <div className="flex justify-start">
              <div className="max-w-[92%] bg-[var(--card)] rounded-2xl rounded-bl-sm px-4 py-2 border border-[var(--border)]">
                {runStream.tools.map((tool, i) => (
                  <ToolCallCard
                    key={i}
                    toolName={tool.tool}
                    toolCallId={`stream-${i}`}
                    state={tool.status === "completed" ? "output-available" : "input-streaming"}
                    output={tool.output}
                  />
                ))}
                {runStream.text ? (
                  <div>
                    <MarkdownRenderer content={runStream.text} isStreaming />
                    <StreamingCursor isStreaming />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 py-0.5 text-xs text-[var(--muted-foreground)] italic">
                    <Icon
                      icon="ph:circle-notch"
                      width={10}
                      height={10}
                      className="animate-spin"
                    />
                    {runStream.status === "pending"
                      ? "Waiting for agent…"
                      : "Thinking…"}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </AutoScrollContainer>

      {/* Composer */}
      <AiComposer
        onSend={(content, opts) => chat.sendMessage(content, opts)}
        onStop={chat.stopGeneration}
        isStreaming={isStreaming}
        isSending={chat.isSending}
        models={providers.models.map((m) => ({ id: m.id, name: m.name }))}
        selectedModel={providers.selectedModel}
        onModelChange={providers.setSelectedModel}
        disabled={!sessions.activeSession}
        placeholder={
          sessions.activeSession
            ? "Ask anything…"
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
  onCloseSession,
  isLoading,
}: {
  sessions: AiSession[];
  activeSession: AiSession | null;
  onSelectSession: (id: string | null) => void;
  onCreateSession: () => void;
  onCloseSession: (id: string) => void;
  isLoading: boolean;
}) {
  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--border)] bg-[var(--card)] overflow-x-auto shrink-0">
      {isLoading && sessions.length === 0 ? (
        <span className="text-xs text-[var(--muted-foreground)]">
          Loading…
        </span>
      ) : (
        sessions.map((session) => {
          const isActive = session.id === activeSession?.id;
          return (
            <div key={session.id} className="group/tab flex items-center shrink-0">
              <button
                type="button"
                onClick={() => onSelectSession(session.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs whitespace-nowrap transition-colors ${
                  isActive
                    ? "bg-[var(--muted)] text-[var(--foreground)] font-medium"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    session.status === "active"
                      ? "bg-emerald-500"
                      : "bg-[var(--muted-foreground)]"
                  }`}
                />
                <span className="truncate max-w-[120px]">
                  {session.title || "New chat"}
                </span>
              </button>
              {isActive && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseSession(session.id);
                    onSelectSession(null);
                  }}
                  className="opacity-0 group-hover/tab:opacity-100 flex items-center justify-center w-5 h-5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-all -ml-0.5"
                  aria-label="Close session"
                >
                  <Icon icon="ph:x" width={10} height={10} />
                </button>
              )}
            </div>
          );
        })
      )}
      <button
        type="button"
        onClick={onCreateSession}
        className="flex items-center justify-center w-6 h-6 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors shrink-0 ml-1"
        aria-label="New session"
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
  messages: AiMessage[];
  isLoading: boolean;
  hasSession: boolean;
}) {
  if (!hasSession) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--muted-foreground)] gap-2 p-8">
        <Icon
          icon="ph:chat-circle-dots"
          width={40}
          height={40}
          className="opacity-40"
        />
        <p className="text-sm">Select or create a session to start</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Icon
          icon="ph:spinner"
          width={24}
          height={24}
          className="animate-spin text-[var(--muted-foreground)]"
        />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--muted-foreground)] gap-2 p-8">
        <Icon
          icon="ph:sparkle"
          width={40}
          height={40}
          className="opacity-40"
        />
        <p className="text-sm">Send a message to get started</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {messages.map((msg, i) => {
        const isLastAssistant =
          msg.role === "assistant" && i === messages.length - 1;
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

function extractTextContent(message: {
  parts?: unknown[];
  content: unknown;
}): string {
  if (Array.isArray(message.parts)) {
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
