import { Icon } from "@iconify/react";

export interface SourceUrlCitationProps {
  type: "source-url";
  sourceId: string;
  url: string;
  title?: string;
}

export interface SourceDocumentCitationProps {
  type: "source-document";
  sourceId: string;
  mediaType: string;
  title: string;
  filename?: string;
}

export type SourceCitationProps = SourceUrlCitationProps | SourceDocumentCitationProps;

export function SourceCitation(props: SourceCitationProps) {
  if (props.type === "source-url") {
    return (
      <a
        href={props.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--border)] transition-colors border border-[var(--border)]"
        title={props.url}
      >
        <Icon icon="ph:globe" width={12} height={12} />
        <span className="truncate max-w-[200px]">
          {props.title || extractDomain(props.url)}
        </span>
        <Icon icon="ph:arrow-square-out" width={10} height={10} className="opacity-60" />
      </a>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-[var(--muted)] text-[var(--muted-foreground)] border border-[var(--border)]"
      title={props.filename || props.title}
    >
      <Icon icon="ph:file-text" width={12} height={12} />
      <span className="truncate max-w-[200px]">{props.title}</span>
    </span>
  );
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}
