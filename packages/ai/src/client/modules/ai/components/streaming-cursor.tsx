export interface StreamingCursorProps {
  isStreaming: boolean;
}

export function StreamingCursor({ isStreaming }: StreamingCursorProps) {
  if (!isStreaming) return null;

  return (
    <span
      className="inline-block w-[3px] h-[1em] bg-[var(--foreground)] rounded-sm animate-pulse align-middle ml-0.5"
      aria-hidden
    />
  );
}
