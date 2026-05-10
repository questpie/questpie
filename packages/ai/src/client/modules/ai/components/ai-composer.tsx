import { Icon } from "@iconify/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size?: number;
}

export interface AiComposerProps {
  onSend: (
    content: string,
    opts?: { model?: string; attachments?: Attachment[] },
  ) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  isSending?: boolean;
  models?: { id: string; name: string }[];
  selectedModel?: string | null;
  onModelChange?: (modelId: string | null) => void;
  attachments?: Attachment[];
  onRemoveAttachment?: (id: string) => void;
  onAddAttachment?: () => void;
  placeholder?: string;
  disabled?: boolean;
}

export function AiComposer({
  onSend,
  onStop,
  isStreaming,
  isSending,
  models,
  selectedModel,
  onModelChange,
  attachments = [],
  onRemoveAttachment,
  onAddAttachment,
  placeholder = "Ask anything…",
  disabled,
}: AiComposerProps) {
  const [content, setContent] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);

  const isDisabled = isSending || disabled;
  const canSend = content.trim().length > 0 && !isDisabled;
  const showStop = isStreaming && onStop;

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, []);

  useLayoutEffect(resize, [content, resize]);

  useEffect(() => {
    if (!isSending && !isStreaming) {
      textareaRef.current?.focus();
    }
  }, [isSending, isStreaming]);

  function handleSubmit() {
    if (!canSend) return;
    onSend(content.trim(), {
      model: selectedModel ?? undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    setContent("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    // TODO: wire file drop to attachment handler
  }

  const activeModel = models?.find((m) => m.id === selectedModel);

  return (
    <div
      className="border-t border-[var(--border)] bg-[var(--card)]"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
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
                  className="ml-0.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                >
                  <Icon icon="ph:x" width={10} height={10} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-1.5 px-3 py-2.5">
        {/* Attach button */}
        {onAddAttachment && (
          <button
            type="button"
            onClick={onAddAttachment}
            disabled={isDisabled}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0"
            aria-label="Attach file"
          >
            <Icon icon="ph:plus" width={18} height={18} />
          </button>
        )}

        {/* Textarea */}
        <div className="flex-1 min-w-0">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isDisabled}
            rows={1}
            className="w-full resize-none bg-transparent text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none py-1.5 leading-relaxed disabled:opacity-50"
            style={{ maxHeight: 180 }}
          />
        </div>

        {/* Send / Stop */}
        {showStop ? (
          <button
            type="button"
            onClick={onStop}
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--destructive)] text-[var(--destructive-foreground)] transition-all hover:opacity-90 shrink-0"
            aria-label="Stop generating"
          >
            <Icon icon="ph:stop-fill" width={14} height={14} />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSend}
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] transition-all hover:opacity-90 disabled:opacity-30 disabled:pointer-events-none shrink-0"
            aria-label="Send message"
          >
            {isSending ? (
              <Icon
                icon="ph:spinner"
                width={16}
                height={16}
                className="animate-spin"
              />
            ) : (
              <Icon icon="ph:arrow-up-bold" width={16} height={16} />
            )}
          </button>
        )}
      </div>

      {/* Footer bar */}
      <div className="flex items-center justify-between px-3 pb-2 pt-0">
        {/* Model picker */}
        <div className="relative">
          <ModelPickerTrigger
            models={models}
            activeModel={activeModel}
            selectedModel={selectedModel}
            showPicker={showModelPicker}
            onToggle={() => setShowModelPicker((v) => !v)}
            onSelect={(id) => {
              onModelChange?.(id);
              setShowModelPicker(false);
            }}
            onClose={() => setShowModelPicker(false)}
          />
        </div>

        {/* Kbd hint */}
        <span className="text-[11px] text-[var(--muted-foreground)] select-none">
          <kbd className="inline-flex items-center rounded px-1 py-0.5 font-mono text-[10px] border border-[var(--border)] bg-[var(--muted)]">
            ↵
          </kbd>{" "}
          send{" "}
          <kbd className="inline-flex items-center rounded px-1 py-0.5 font-mono text-[10px] border border-[var(--border)] bg-[var(--muted)]">
            ⇧↵
          </kbd>{" "}
          newline
        </span>
      </div>
    </div>
  );
}

function ModelPickerTrigger({
  models,
  activeModel,
  selectedModel,
  showPicker,
  onToggle,
  onSelect,
  onClose,
}: {
  models?: { id: string; name: string }[];
  activeModel?: { id: string; name: string };
  selectedModel?: string | null;
  showPicker: boolean;
  onToggle: () => void;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  if (!models || models.length === 0) {
    if (!selectedModel) return null;
    return (
      <span className="text-[11px] text-[var(--muted-foreground)] px-1.5">
        <Icon
          icon="ph:cpu"
          width={12}
          height={12}
          className="inline-block mr-1 -mt-0.5"
        />
        {selectedModel}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
      >
        <Icon icon="ph:cpu" width={12} height={12} />
        <span className="truncate max-w-[140px]">
          {activeModel?.name ?? "Auto"}
        </span>
        <Icon icon="ph:caret-down" width={10} height={10} />
      </button>
      {showPicker && (
        <ModelPickerDropdown
          models={models}
          selectedModel={selectedModel}
          onSelect={onSelect}
          onClose={onClose}
        />
      )}
    </>
  );
}

function ModelPickerDropdown({
  models,
  selectedModel,
  onSelect,
  onClose,
}: {
  models: { id: string; name: string }[];
  selectedModel: string | null | undefined;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 mb-1 w-52 max-h-48 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--popover)] text-[var(--popover-foreground)] shadow-lg z-50"
    >
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`flex items-center w-full gap-2 px-3 py-1.5 text-xs transition-colors ${
          !selectedModel
            ? "bg-[var(--muted)] text-[var(--foreground)]"
            : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
        }`}
      >
        <Icon icon="ph:sparkle" width={14} height={14} />
        Auto
      </button>
      {models.map((model) => (
        <button
          key={model.id}
          type="button"
          onClick={() => onSelect(model.id)}
          className={`flex items-center w-full gap-2 px-3 py-1.5 text-xs transition-colors ${
            selectedModel === model.id
              ? "bg-[var(--muted)] text-[var(--foreground)]"
              : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          }`}
        >
          <Icon icon="ph:cpu" width={14} height={14} />
          <span className="truncate">{model.name}</span>
          {selectedModel === model.id && (
            <Icon
              icon="ph:check"
              width={14}
              height={14}
              className="ml-auto text-[var(--primary)]"
            />
          )}
        </button>
      ))}
    </div>
  );
}
