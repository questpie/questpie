import { Icon } from "@iconify/react";
import { createElement, useMemo, useState, type ReactNode } from "react";
import { createLowlight, common } from "lowlight";

const lowlight = createLowlight(common);

export interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

export function MarkdownRenderer({
  content,
  isStreaming,
  className,
}: MarkdownRendererProps) {
  const blocks = useMemo(() => parseBlocks(content, isStreaming), [content, isStreaming]);

  if (!content) return null;

  return (
    <div className={`space-y-3 text-sm leading-relaxed ${className ?? ""}`}>
      {blocks.map((block, i) => (
        <BlockRenderer key={i} block={block} />
      ))}
    </div>
  );
}

// --- Block types ---

type Block =
  | { type: "paragraph"; content: string }
  | { type: "heading"; level: number; content: string }
  | { type: "code"; lang?: string; code: string }
  | { type: "blockquote"; content: string }
  | { type: "unordered-list"; items: ListItem[] }
  | { type: "ordered-list"; items: ListItem[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "hr" };

interface ListItem {
  content: string;
  children?: ListItem[];
}

// --- Block parsing ---

function parseBlocks(text: string, isStreaming?: boolean): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block
    const codeFenceMatch = line.match(/^(`{3,}|~{3,})(\w*)/);
    if (codeFenceMatch) {
      const fence = codeFenceMatch[1]!;
      const lang = codeFenceMatch[2] || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith(fence)) {
        codeLines.push(lines[i]!);
        i++;
      }
      if (i < lines.length) i++; // skip closing fence
      // If streaming and no closing fence found, still render what we have
      blocks.push({ type: "code", lang, code: codeLines.join("\n") });
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1]!.length,
        content: headingMatch[2]!,
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // Table
    if (line.includes("|") && i + 1 < lines.length && /^\|?\s*[-:]+[-| :]*$/.test(lines[i + 1]!)) {
      const headerLine = line.replace(/^\||\|$/g, "");
      const headers = headerLine.split("|").map((h) => h.trim());
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|")) {
        const rowLine = lines[i]!.replace(/^\||\|$/g, "");
        rows.push(rowLine.split("|").map((c) => c.trim()));
        i++;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    // Blockquote
    if (line.startsWith("> ") || line === ">") {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i]!.startsWith("> ") || lines[i] === ">")) {
        quoteLines.push(lines[i]!.replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", content: quoteLines.join("\n") });
      continue;
    }

    // Unordered list
    if (/^[-*]\s/.test(line)) {
      const items = parseListItems(lines, i, /^([-*])\s/);
      i = items.endIndex;
      blocks.push({ type: "unordered-list", items: items.items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items = parseListItems(lines, i, /^(\d+\.)\s/);
      i = items.endIndex;
      blocks.push({ type: "ordered-list", items: items.items });
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph (consecutive non-empty lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !lines[i]!.match(/^(`{3,}|~{3,}|#{1,6}\s|[-*]\s|\d+\.\s|>\s|(-{3,}|\*{3,}|_{3,})\s*$)/)
    ) {
      paraLines.push(lines[i]!);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: "paragraph", content: paraLines.join("\n") });
    }
  }

  return blocks;
}

function parseListItems(
  lines: string[],
  startIndex: number,
  markerPattern: RegExp
): { items: ListItem[]; endIndex: number } {
  const items: ListItem[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i]!;

    // Top-level item
    if (markerPattern.test(line)) {
      const content = line.replace(/^[-*]\s|^\d+\.\s/, "");
      const item: ListItem = { content };
      i++;

      // Collect nested items (indented by 2+ spaces)
      const children: ListItem[] = [];
      while (i < lines.length && /^\s{2,}[-*]\s|^\s{2,}\d+\.\s/.test(lines[i]!)) {
        const childContent = lines[i]!.replace(/^\s+[-*]\s|^\s+\d+\.\s/, "");
        children.push({ content: childContent });
        i++;
      }
      if (children.length > 0) {
        item.children = children;
      }
      items.push(item);
      continue;
    }

    break;
  }

  return { items, endIndex: i };
}

// --- Block rendering ---

function BlockRenderer({ block }: { block: Block }) {
  switch (block.type) {
    case "paragraph":
      return (
        <p>
          <InlineRenderer text={block.content} />
        </p>
      );
    case "heading": {
      const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      const sizeClass = [
        "text-xl font-bold",
        "text-lg font-bold",
        "text-base font-semibold",
        "text-sm font-semibold",
        "text-sm font-medium",
        "text-xs font-medium uppercase tracking-wide",
      ][block.level - 1];
      return (
        <Tag className={sizeClass}>
          <InlineRenderer text={block.content} />
        </Tag>
      );
    }
    case "code":
      return <CodeBlock language={block.lang} code={block.code} />;
    case "blockquote":
      return (
        <blockquote className="border-l-2 border-[var(--border)] pl-3 text-[var(--muted-foreground)] italic">
          <InlineRenderer text={block.content} />
        </blockquote>
      );
    case "unordered-list":
      return (
        <ul className="list-disc pl-5 space-y-1">
          {block.items.map((item, i) => (
            <li key={i}>
              <InlineRenderer text={item.content} />
              {item.children && (
                <ul className="list-disc pl-5 mt-1 space-y-0.5">
                  {item.children.map((child, j) => (
                    <li key={j}>
                      <InlineRenderer text={child.content} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      );
    case "ordered-list":
      return (
        <ol className="list-decimal pl-5 space-y-1">
          {block.items.map((item, i) => (
            <li key={i}>
              <InlineRenderer text={item.content} />
              {item.children && (
                <ol className="list-decimal pl-5 mt-1 space-y-0.5">
                  {item.children.map((child, j) => (
                    <li key={j}>
                      <InlineRenderer text={child.content} />
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ol>
      );
    case "table":
      return (
        <div className="overflow-x-auto rounded border border-[var(--border)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted)]">
                {block.headers.map((h, i) => (
                  <th key={i} className="px-3 py-1.5 text-left font-medium">
                    <InlineRenderer text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className="border-b border-[var(--border)] last:border-b-0">
                  {row.map((cell, j) => (
                    <td key={j} className="px-3 py-1.5">
                      <InlineRenderer text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "hr":
      return <hr className="border-[var(--border)]" />;
  }
}

// --- Code block with highlighting ---

function CodeBlock({ language, code }: { language?: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const highlighted = useMemo(() => {
    if (!language) return null;
    try {
      if (lowlight.registered(language)) {
        return lowlight.highlight(language, code);
      }
    } catch {
      // fall through to plain rendering
    }
    return null;
  }, [language, code]);

  function handleCopy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border)]">
        <span className="text-[11px] font-mono text-[var(--muted-foreground)]">
          {language || "text"}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          title="Copy code"
        >
          <Icon
            icon={copied ? "ph:check" : "ph:clipboard"}
            width={14}
            height={14}
          />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed font-mono">
        <code>
          {highlighted ? (
            <HastRenderer nodes={highlighted.children as unknown as HastNode[]} />
          ) : (
            code
          )}
        </code>
      </pre>
    </div>
  );
}

// --- Hast to React ---

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  value?: string;
};

function HastRenderer({ nodes }: { nodes: HastNode[] }): ReactNode {
  return nodes.map((node, i) => {
    if (node.type === "text") {
      return node.value ?? "";
    }
    if (node.type === "element" && node.tagName) {
      const className = Array.isArray(node.properties?.className)
        ? (node.properties.className as string[]).join(" ")
        : (node.properties?.className as string) ?? undefined;
      return createElement(
        node.tagName,
        { key: i, className },
        node.children ? <HastRenderer nodes={node.children} /> : null
      );
    }
    return null;
  });
}

// --- Inline parsing ---

function InlineRenderer({ text }: { text: string }): ReactNode {
  const nodes = useMemo(() => parseInline(text), [text]);
  return <>{nodes}</>;
}

function parseInline(text: string): ReactNode[] {
  const result: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Inline code (highest priority — content not parsed further)
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      result.push(
        <code
          key={key++}
          className="bg-[var(--muted)] px-1.5 py-0.5 rounded text-[13px] font-mono border border-[var(--border)]"
        >
          {codeMatch[1]}
        </code>
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Link
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      result.push(
        <a
          key={key++}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--primary)] underline underline-offset-2 hover:opacity-80"
        >
          {linkMatch[1]}
        </a>
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Bold
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      result.push(<strong key={key++}>{parseInline(boldMatch[1]!)}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Strikethrough
    const strikeMatch = remaining.match(/^~~(.+?)~~/);
    if (strikeMatch) {
      result.push(<del key={key++}>{parseInline(strikeMatch[1]!)}</del>);
      remaining = remaining.slice(strikeMatch[0].length);
      continue;
    }

    // Italic
    const italicMatch = remaining.match(/^\*([^*]+?)\*|^_([^_]+?)_/);
    if (italicMatch) {
      const content = italicMatch[1] ?? italicMatch[2]!;
      result.push(<em key={key++}>{parseInline(content)}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Plain text until next special character
    const nextSpecial = remaining.slice(1).search(/[`*_~[]/);
    if (nextSpecial === -1) {
      result.push(remaining);
      break;
    }
    result.push(remaining.slice(0, nextSpecial + 1));
    remaining = remaining.slice(nextSpecial + 1);
  }

  return result;
}
