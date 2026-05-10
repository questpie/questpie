import { useAiSessions } from "../hooks/use-ai-sessions.js";

export function SessionTabs() {
  const { sessions, activeSession, setActiveSession, createSession } =
    useAiSessions();

  return (
    <div data-ai-session-tabs>
      {sessions.map((session) => (
        <button
          key={session.id}
          type="button"
          onClick={() => setActiveSession(session.id)}
          data-active={session.id === activeSession?.id}
        >
          {session.title ?? "Chat"}
        </button>
      ))}
      <button type="button" onClick={() => createSession()}>
        +
      </button>
    </div>
  );
}
