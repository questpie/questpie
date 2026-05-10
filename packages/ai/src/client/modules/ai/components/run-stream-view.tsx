import { useRunStream } from "../hooks/use-run-stream.js";

export interface RunStreamViewProps {
  runId: string;
}

export function RunStreamView({ runId }: RunStreamViewProps) {
  const { text, status, events, tools, isStreaming } = useRunStream({ runId });

  return (
    <div data-ai-run-stream data-status={status}>
      {isStreaming && <div data-ai-streaming-indicator>Streaming...</div>}
      {tools.map((tool, i) => (
        <div key={i} data-ai-tool-call data-status={tool.status}>
          {tool.tool}
        </div>
      ))}
      {text && <div data-ai-stream-text>{text}</div>}
      {!isStreaming && status === "completed" && (
        <div data-ai-completed>Done ({events.length} events)</div>
      )}
      {status === "failed" && <div data-ai-failed>Run failed</div>}
    </div>
  );
}
