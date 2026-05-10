import { Icon } from "@iconify/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export interface AutoScrollContainerProps {
  children: ReactNode;
  className?: string;
  dependencies?: unknown[];
}

export function AutoScrollContainer({
  children,
  className,
  dependencies = [],
}: AutoScrollContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const checkIfAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const threshold = 60;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setIsAtBottom(atBottom);
    setShowScrollButton(!atBottom);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkIfAtBottom, { passive: true });
    return () => el.removeEventListener("scroll", checkIfAtBottom);
  }, [checkIfAtBottom]);

  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependencies, children]);

  function scrollToBottom() {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  function handleScrollToBottom() {
    scrollToBottom();
    setShowScrollButton(false);
    setIsAtBottom(true);
  }

  return (
    <div className={`relative flex-1 overflow-hidden ${className ?? ""}`}>
      <div
        ref={containerRef}
        className="h-full overflow-y-auto scroll-smooth"
      >
        {children}
      </div>

      {showScrollButton && (
        <button
          type="button"
          onClick={handleScrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--card)] border border-[var(--border)] text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] shadow-lg transition-all hover:shadow-xl"
          aria-label="Scroll to bottom"
        >
          <Icon icon="ph:arrow-down" width={14} height={14} />
          New messages
        </button>
      )}
    </div>
  );
}
