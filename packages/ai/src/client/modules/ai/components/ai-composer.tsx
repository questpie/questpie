import { Icon } from "@iconify/react";
import { useCallback, useRef, useState } from "react";

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size?: number;
}

export interface AiComposerProps {
  onSend: (content: string, opts?: { model?: string; attachments?: Attachment[] }) => void;
  isLoading?: boolean;
  selectedModel?: string | null;
  attachments?: Attachment[];
  onRemoveAttachment?: (id: string) => void;
  onAddAttachment?: () => void;
  placeholder?: string;
  disabled?: boolean;
}

export function AiComposer({
  onSend,
  isLoading,
  selectedModel,
  attachments = [],
  onRemoveAttachment,
  onAddAttachment,
  placeholder = "Type a message...",
  disabled,
}: AiComposerProps) {
  const [content, setContent] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!content.trim() || isLoading || disabled) return;
      onSend(content, {
        model: selectedModel ?? undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      setContent("");
      resetTextareaHeight();
    },
    [content, isLoading, disabled, onSend, selectedModel, attachments],
  );

  function resetTextareaHeight() {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value);
    autoResize(e.target);
  }

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const isDisabled = isLoading || disabled;
  const canSend = content.trim().length > 0 && !isDisabled;

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-[var(--border)] bg-[var(--card)] p-3"
    >
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {attachments.map((att) => (
            <span
              key={att.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--muted)] border border-[var(--border)] text-[11px] text-[var(--foreground)]"
            >
              <Icon icon="ph:paperclip" width={12} height={12} />
              <span className="truncate max-w-[120px]">{att.name}</span>
              {onRemoveAttachment && (
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(att.id)}
                  className="ml-0.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                >
                  <Icon icon="ph:x" width={10} height={10} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        {onAddAttachment && (
          <button
            type="button"
            onClick={onAddAttachment}
            disabled={isDisabled}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0"
            title="Attach file"
          >
            <Icon icon="ph:plus" width={18} height={18} />
          </button>
        )}

        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isDisabled}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none py-1.5 leading-relaxed max-h-[200px] disabled:opacity-50"
        />

        <button
          type="submit"
          disabled={!canSend}
          className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] transition-all hover:opacity-90 disabled:opacity-30 disabled:pointer-events-none shrink-0"
          title="Send message"
        >
          {isLoading ? (
            <Icon icon="ph:circle-notch" width={16} height={16} className="animate-spin" />
          ) : (
            <Icon icon="ph:arrow-up-bold" width={16} height={16} />
          )}
        </button>
      </div>

      {selectedModel && (
        <div className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
          {selectedModel}
        </div>
      )}
    </form>
  );
}
