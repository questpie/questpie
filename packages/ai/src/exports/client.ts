// Hooks
export { useAiChat } from "../client/modules/ai/hooks/use-ai-chat.js";
export type { AiMessage, UseAiChatOptions } from "../client/modules/ai/hooks/use-ai-chat.js";

export { useAiSessions } from "../client/modules/ai/hooks/use-ai-sessions.js";
export type { AiSession } from "../client/modules/ai/hooks/use-ai-sessions.js";

export { useRunStream } from "../client/modules/ai/hooks/use-run-stream.js";
export type { RunEvent, ToolCallState, UseRunStreamOptions } from "../client/modules/ai/hooks/use-run-stream.js";

export { useAiProviders } from "../client/modules/ai/hooks/use-ai-providers.js";
export type { AiModel, AiProvider } from "../client/modules/ai/hooks/use-ai-providers.js";

// Main components
export { AiChatRail } from "../client/modules/ai/components/ai-chat-rail.js";
export type { AiChatRailProps } from "../client/modules/ai/components/ai-chat-rail.js";

export { AiComposer } from "../client/modules/ai/components/ai-composer.js";
export type { AiComposerProps, Attachment } from "../client/modules/ai/components/ai-composer.js";

export { AiMessageBubble } from "../client/modules/ai/components/ai-message-bubble.js";
export type { AiMessageBubbleProps } from "../client/modules/ai/components/ai-message-bubble.js";

// Sub-components (for custom composition)
export { MarkdownRenderer } from "../client/modules/ai/components/markdown-renderer.js";
export type { MarkdownRendererProps } from "../client/modules/ai/components/markdown-renderer.js";

export { ToolCallCard } from "../client/modules/ai/components/tool-call-card.js";
export type { ToolCallCardProps } from "../client/modules/ai/components/tool-call-card.js";

export { ReasoningSection } from "../client/modules/ai/components/reasoning-section.js";
export type { ReasoningSectionProps } from "../client/modules/ai/components/reasoning-section.js";

export { SourceCitation } from "../client/modules/ai/components/source-citation.js";
export type { SourceCitationProps, SourceUrlCitationProps, SourceDocumentCitationProps } from "../client/modules/ai/components/source-citation.js";

export { StreamingCursor } from "../client/modules/ai/components/streaming-cursor.js";
export type { StreamingCursorProps } from "../client/modules/ai/components/streaming-cursor.js";

export { AutoScrollContainer } from "../client/modules/ai/components/auto-scroll-container.js";
export type { AutoScrollContainerProps } from "../client/modules/ai/components/auto-scroll-container.js";

export { MessageActions } from "../client/modules/ai/components/message-actions.js";
export type { MessageActionsProps } from "../client/modules/ai/components/message-actions.js";

// Legacy components (kept for compatibility)
export { SessionTabs } from "../client/modules/ai/components/session-tabs.js";
export { ModelPicker } from "../client/modules/ai/components/model-picker.js";
export { RunStreamView } from "../client/modules/ai/components/run-stream-view.js";
export type { RunStreamViewProps } from "../client/modules/ai/components/run-stream-view.js";
